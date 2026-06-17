document.addEventListener('DOMContentLoaded', () => {
    const inputArea = document.getElementById('bp-input');
    const outputArea = document.getElementById('bp-output');
    const analyzeBtn = document.getElementById('analyze-btn');
    const copyBtn = document.getElementById('copy-btn');

    // ---------------------------------------------------------
    // REGEX PATTERNS 
    // ---------------------------------------------------------
    const regexObjectBlock = /Begin Object([\s\S]*?)End Object/g;
    const regexClass = /Class=(?:\/[^\/]+\/)*([^ ]+)/;
    const regexName = /Name="([^"]+)"/;
    const regexMemberName = /MemberName="([^"]+)"/;
    const regexPin = /CustomProperties Pin \(.*/g;

    // Pin Property Extraction
    const regexPinName = /PinName="([^"]+)"/;
    const regexIsOutput = /Direction="EGPD_Output"/;
    const regexIsExec = /PinType\.PinCategory="exec"/;
    const regexIsHidden = /bHidden=True/;
    const regexLinkedTo = /LinkedTo=\(([^ ]+)/;

    // Value Extraction 
    const regexDefaultValue = /DefaultValue="([^"]+)"/;
    const regexDefaultText = /DefaultTextValue=NSLOCTEXT\("[^"]+",\s*"[^"]+",\s*"([^"]+)"\)/;
    const regexDefaultObj = /DefaultObject="[^"]*\/([^\/"]+)"/;

    // Context Extraction (NEW)
    // Grabs the Blueprint Name and Graph/Function Name from the ExportPath
    const regexContext = /ExportPath="[^\"]+\/([^\/\.]+)\.[^\.]+:([^\.]+)\./;

    // Behavior Tree Extraction (NEW)
    const regexDecorators = /Decorators=\(([^\)]+)\)/;
    const regexServices = /Services=\(([^\)]+)\)/;

    // ---------------------------------------------------------
    // PARSING LOGIC
    // ---------------------------------------------------------
    analyzeBtn.addEventListener('click', () => {
        const rawText = inputArea.value;
        if (!rawText.trim()) {
            outputArea.textContent = "Please paste some Blueprint or Behavior Tree text first.";
            return;
        }

        const nodes = {};
        const blocks = [...rawText.matchAll(regexObjectBlock)];

        if (blocks.length === 0) {
            outputArea.textContent = "No valid Unreal Engine nodes found. Ensure you copied full nodes.";
            return;
        }

        // --- NEW: EXTRACT HEADER CONTEXT ---
        let assetName = "Unknown Asset";
        let graphName = "Unknown Graph";
        let assetType = "Blueprint";

        // Check the very first block to identify where this text came from
        const firstBlockContext = blocks[0][0].match(regexContext);
        if (firstBlockContext) {
            assetName = firstBlockContext[1]; // e.g., BP_QueueManager or BT_Customer
            graphName = firstBlockContext[2]; // e.g., FindTableForParty, EventGraph, or BehaviorTreeGraph_0

            if (blocks[0][0].includes("BehaviorTree")) {
                assetType = "Behavior Tree";
            }
        }

        // Pass 1: Parse all blocks and extract raw data
        blocks.forEach(match => {
            const blockContent = match[0];

            const nameMatch = blockContent.match(regexName);
            const classMatch = blockContent.match(regexClass);
            const memberMatch = blockContent.match(regexMemberName);

            const name = nameMatch ? nameMatch[1] : "Unknown_Node";
            let className = classMatch ? classMatch[1].split('.').pop() : "Unknown_Class";
            const memberName = memberMatch ? memberMatch[1] : null;

            // Simplify Behavior Tree Node Names
            if (className.startsWith("BehaviorTreeGraphNode_")) {
                className = className.replace("BehaviorTreeGraphNode_", "BT_");
            }

            const execLinks = [];
            const dataLinks = [];
            const variables = [];

            // --- NEW: BEHAVIOR TREE ATTACHMENTS ---
            const decMatch = blockContent.match(regexDecorators);
            const srvMatch = blockContent.match(regexServices);

            if (decMatch) {
                // Split by comma in case there are multiple decorators
                const decorators = decMatch[1].split(',').filter(d => d.trim() !== "");
                decorators.forEach(d => variables.push({ pinName: "Decorator", value: d.split(' ')[0] }));
            }
            if (srvMatch) {
                const services = srvMatch[1].split(',').filter(s => s.trim() !== "");
                services.forEach(s => variables.push({ pinName: "Service", value: s.split(' ')[0] }));
            }

            // Standard Blueprint Pin Extraction
            const pinMatches = [...blockContent.matchAll(regexPin)];

            pinMatches.forEach(pinMatch => {
                const pinData = pinMatch[0];

                const pinNameMatch = pinData.match(regexPinName);
                const pinName = pinNameMatch ? pinNameMatch[1] : "UnknownPin";

                const isOutput = regexIsOutput.test(pinData);
                const isExec = regexIsExec.test(pinData);
                const isHidden = regexIsHidden.test(pinData);
                const linkMatch = pinData.match(regexLinkedTo);

                // 1. Capture Execution Flow
                if (isOutput && isExec && linkMatch) {
                    const targetNode = linkMatch[1];
                    if (!execLinks.includes(targetNode)) execLinks.push(targetNode);
                }
                // 2. Capture Data Connections
                else if (!isOutput && linkMatch && !isHidden && pinName !== "execute") {
                    dataLinks.push({ pinName: pinName, targetNode: linkMatch[1] });
                }
                // 3. Capture Static Variables
                else if (!isOutput && !isHidden && !linkMatch && pinName !== "execute" && pinName !== "then") {

                    let textMatch = pinData.match(regexDefaultText);
                    let objMatch = pinData.match(regexDefaultObj);
                    let valMatch = pinData.match(regexDefaultValue);

                    if (textMatch) {
                        variables.push({ pinName: pinName, value: `"${textMatch[1]}"` });
                    } else if (objMatch) {
                        let cleanObjName = objMatch[1].split('.').pop();
                        variables.push({ pinName: pinName, value: cleanObjName });
                    } else if (valMatch) {
                        variables.push({ pinName: pinName, value: valMatch[1] });
                    } else {
                        if (pinName === "self") {
                            variables.push({ pinName: "Target", value: "(Implicit Self)" });
                        } else {
                            variables.push({ pinName: pinName, value: "(Empty)" });
                        }
                    }
                }
            });

            // Save to dictionary
            nodes[name] = {
                className: className,
                memberName: memberName,
                execLinks: execLinks,
                dataLinks: dataLinks,
                variables: variables
            };
        });

        // Pass 2: Format the Output

        // --- NEW: INJECT HEADER ---
        let resultString = `=== ASSET SUMMARY ===\n`;
        resultString += `Asset Name: ${assetName}\n`;
        resultString += `Graph/Function: ${graphName}\n`;
        resultString += `Type: ${assetType}\n`;
        resultString += `=====================\n\n`;

        for (const [nodeName, data] of Object.entries(nodes)) {
            // Skip hidden inner nodes that Unreal creates for Behavior Trees
            if (nodeName.startsWith("BTTask_") || nodeName.startsWith("BTDecorator_") || nodeName.startsWith("BTService_")) {
                continue;
            }

            const descriptor = data.memberName ? data.memberName : data.className;
            resultString += `[${nodeName}: ${descriptor}]\n`;

            // Print Static Variables & BT Attachments
            data.variables.forEach(v => {
                resultString += `  • [Variable] ${v.pinName} = ${v.value}\n`;
            });

            // Print Data Links
            data.dataLinks.forEach(dl => {
                let targetDesc = "Unknown";
                if (nodes[dl.targetNode]) {
                    const tNode = nodes[dl.targetNode];
                    targetDesc = tNode.memberName ? tNode.memberName : tNode.className;
                }
                resultString += `  • [Input Link] ${dl.pinName} <- receives from [${targetDesc}]\n`;
            });

            // Print Execution Flow
            if (data.execLinks.length > 0) {
                data.execLinks.forEach(target => {
                    let targetDescriptor = "";
                    if (nodes[target]) {
                        const tNode = nodes[target];
                        targetDescriptor = `: ${tNode.memberName ? tNode.memberName : tNode.className}`;
                    }
                    resultString += `  -> Connects to: [${target}${targetDescriptor}]\n`;
                });
            } else {
                resultString += `  -> (Isolated Flow / No Outgoing Connection)\n`;
            }

            resultString += "\n";
        }

        outputArea.textContent = resultString.trim() || "Nodes parsed, but an error occurred during formatting.";
    });

    // ---------------------------------------------------------
    // COPY FUNCTIONALITY
    // ---------------------------------------------------------
    copyBtn.addEventListener('click', () => {
        const textToCopy = outputArea.textContent;
        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = "Copied!";
            setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            alert("Copy failed. Please select the text manually.");
        });
    });
});