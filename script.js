document.addEventListener("DOMContentLoaded", () => {
  const inputArea = document.getElementById("bp-input");
  const outputArea = document.getElementById("bp-output");
  const analyzeBtn = document.getElementById("analyze-btn");
  const copyBtn = document.getElementById("copy-btn");

  // ---------------------------------------------------------
  // PARSING LOGIC
  // ---------------------------------------------------------
  analyzeBtn.addEventListener("click", () => {
    const rawText = inputArea.value;
    if (!rawText.trim()) {
      outputArea.textContent = "Please paste some Blueprint or Behavior Tree text first.";
      return;
    }

    outputArea.textContent = parseT3DToMarkdown(rawText);
  });

  // ---------------------------------------------------------
  // COPY FUNCTIONALITY
  // ---------------------------------------------------------
  copyBtn.addEventListener("click", () => {
    const textToCopy = outputArea.textContent;
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
        alert("Copy failed. Please select the text manually.");
      });
  });
});

function parseT3DToMarkdown(rawText) {
    if (!rawText.trim()) return "No valid text provided.";

    const lines = rawText.split(/\r?\n/);
    const objects = {};
    const stack = [];
    let assetName = "Unknown Asset";
    let assetType = "Blueprint";

    if (rawText.includes("BehaviorTree")) {
        assetType = "Behavior Tree";
    }

    // 1. AST STACK EXTRACTOR (Phase 1 & 2 Merge)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith("Begin Object ")) {
            const attrs = {};
            const attrMatches = trimmed.matchAll(/([a-zA-Z0-9_]+)=("[^"]*"|'[^']*'|[^ ]+)/g);
            for (const match of attrMatches) {
                let val = match[2];
                if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
                attrs[match[1]] = val;
            }
            
            let objName = attrs.Name;
            if (!objName) continue;

            if (attrs.Class && attrs.Class.includes("Engine.Blueprint")) {
                assetName = objName;
            }

            let objKey = attrs.ExportPath || attrs.Name;

            let newObj = {
                key: objKey,
                name: objName,
                className: attrs.Class || "",
                parentKey: stack.length > 0 ? stack[stack.length - 1].key : null,
                lines: [],
                pins: []
            };

            if (!objects[objKey]) {
                objects[objKey] = newObj;
            } else {
                if (attrs.Class) objects[objKey].className = attrs.Class;
                if (!objects[objKey].parentKey && newObj.parentKey) {
                    objects[objKey].parentKey = newObj.parentKey;
                } else if (newObj.parentKey && objects[objKey].parentKey !== newObj.parentKey) {
                    objects[objKey].parentKey = newObj.parentKey;
                }
            }

            stack.push(objects[objKey]);
        } else if (trimmed === "End Object") {
            stack.pop();
        } else {
            if (stack.length > 0) {
                const currentObj = stack[stack.length - 1];
                currentObj.lines.push(trimmed);
                if (trimmed.startsWith("CustomProperties Pin ")) {
                    currentObj.pins.push(trimmed);
                }
            }
        }
    }

    // 2. Map Graphs and Extract Nodes
    const graphs = {}; 
    for (const key in objects) {
        const obj = objects[key];
        if (obj.className && (obj.className.includes("Engine.EdGraph") || obj.className.includes("Engine.FunctionGraph"))) {
            graphs[key] = obj.name;
        }
    }

    const extractedNodes = Object.values(objects).filter(obj => 
        obj.className && obj.className.includes("Node") && !obj.className.includes("EdGraphPin")
    );

    if (extractedNodes.length === 0) return "No valid Unreal Engine nodes found.";

    // Assign graph names to nodes
    extractedNodes.forEach(nodeObj => {
        let graphName = "Unknown Graph";
        let parentKey = nodeObj.parentKey;
        while (parentKey && objects[parentKey]) {
            if (graphs[parentKey]) {
                graphName = graphs[parentKey];
                break;
            }
            parentKey = objects[parentKey].parentKey;
        }
        nodeObj.graphName = graphName;
    });

    // Lookup table for node name within a graph to its global key
    const nodeLookup = {};
    extractedNodes.forEach(nodeObj => {
        if (!nodeLookup[nodeObj.graphName]) nodeLookup[nodeObj.graphName] = {};
        nodeLookup[nodeObj.graphName][nodeObj.name] = nodeObj.key;
    });

    // 2.5 Extract all Pin IDs and their Names
    const pinIdToName = {};
    extractedNodes.forEach((nodeObj) => {
        let allPins = [...nodeObj.pins];
        Object.values(objects).forEach(childObj => {
            if (childObj.parentKey === nodeObj.key && childObj.className.includes("EdGraphPin")) {
                allPins.push(childObj.lines.join(' '));
            }
        });
        
        allPins.forEach((pinData) => {
            const pinIdMatch = pinData.match(/PinId=([a-zA-Z0-9_]+)/);
            const pinNameMatch = pinData.match(/PinName="([^"]+)"/);
            if (pinIdMatch && pinNameMatch) {
                pinIdToName[pinIdMatch[1]] = pinNameMatch[1];
            }
        });
    });

    const nodes = {};

    // 3. DATA TRANSLATOR
    extractedNodes.forEach((nodeObj) => {
        let className = nodeObj.className.split('.').pop();
        const name = nodeObj.name;
        const blockContent = nodeObj.lines.join('\n');
        const graphName = nodeObj.graphName;

        let memberName = null;
        const funcRef = blockContent.match(/FunctionReference=\([\s\S]*?MemberName="([^"]+)"/);
        const varRef = blockContent.match(/VariableReference=\([\s\S]*?MemberName="([^"]+)"/);
        const evtRef = blockContent.match(/EventReference=\([\s\S]*?MemberName="([^"]+)"/);
        const customFunc = blockContent.match(/CustomFunctionName="([^"]+)"/);
        const macroRef = blockContent.match(/MacroGraphReference=\([\s\S]*?MemberName="([^"]+)"/);
        const delegateRef = blockContent.match(/DelegateReference=\([\s\S]*?MemberName="([^"]+)"/);

        if (funcRef) memberName = funcRef[1];
        else if (varRef) memberName = varRef[1];
        else if (evtRef) memberName = evtRef[1];
        else if (customFunc) memberName = customFunc[1];
        else if (macroRef) memberName = macroRef[1];
        else if (delegateRef) memberName = delegateRef[1];
        else if (className === "K2Node_DynamicCast") {
            const castMatch = blockContent.match(/TargetType=".*?([^\/"]+)'"/);
            if (castMatch) memberName = `Cast To ${castMatch[1]}`;
        } else if (className === "K2Node_Event") {
            const evtName = blockContent.match(/EventSignatureName="([^"]+)"/);
            if (evtName) memberName = evtName[1];
        }

        if (!memberName) {
            const genericMember = blockContent.match(/MemberName="([^"]+)"/);
            if (genericMember) memberName = genericMember[1];
        }

        if (className === "K2Node_IfThenElse") className = "Branch";
        if (className === "K2Node_Knot") className = "Reroute";
        if (className === "K2Node_ExecutionSequence") className = "Sequence";
        if (className === "K2Node_FunctionEntry") className = "Function Entry";
        if (className === "K2Node_FunctionResult") {
            className = "Return Node";
            memberName = "Return Node";
        }
        if (className === "K2Node_MacroInstance") {
            className = "Macro";
            const macroLine = nodeObj.lines.find(l => l.includes("MacroGraphReference="));
            if (macroLine) {
                const match = macroLine.match(/MacroGraph="[^"]+:([^"']+)'"/);
                if (match) {
                    memberName = match[1];
                }
            }
        }
        
        if (className.startsWith("BehaviorTreeGraphNode_")) {
            className = className.replace("BehaviorTreeGraphNode_", "BT_");
        }

        const execOutLinks = [];
        const dataInLinks = [];
        const dataOutPins = [];
        const variables = [];
        let hasExecIn = false;
        let hasExecOut = false;

        // Extract BT Decorators and Services
        const decMatch = blockContent.match(/Decorators=\(([^\)]+)\)/);
        const srvMatch = blockContent.match(/Services=\(([^\)]+)\)/);

        if (decMatch) {
            const decorators = decMatch[1].split(",").filter((d) => d.trim() !== "");
            decorators.forEach((d) => variables.push({ pinName: "Decorator", type: "BT", value: d.split(" ")[0] }));
        }
        if (srvMatch) {
            const services = srvMatch[1].split(",").filter((s) => s.trim() !== "");
            services.forEach((s) => variables.push({ pinName: "Service", type: "BT", value: s.split(" ")[0] }));
        }

        let allPins = [...nodeObj.pins];
        Object.values(objects).forEach(childObj => {
            if (childObj.parentKey === nodeObj.key && childObj.className.includes("EdGraphPin")) {
                allPins.push(childObj.lines.join(' '));
            }
        });

        allPins.forEach((pinData) => {
            const pinNameMatch = pinData.match(/PinName="([^"]+)"/);
            const pinName = pinNameMatch ? pinNameMatch[1] : "UnknownPin";

            const isOutput = /Direction="EGPD_Output"/.test(pinData);
            const isHidden = /bHidden=True/.test(pinData);
            const pinCategoryMatch = pinData.match(/PinCategory="([^"]+)"/);
            let pinCategory = pinCategoryMatch ? pinCategoryMatch[1] : "unknown";

            const isExec = pinCategory === "exec";

            let linkedNodes = [];
            const linkMatch = pinData.match(/LinkedTo=\(([^)]+)\)/);
            if (linkMatch) {
                const links = linkMatch[1].split(",");
                linkedNodes = links.map(l => {
                    const trimmedL = l.trim();
                    if (!trimmedL) return null;
                    
                    let targetName = null;
                    let targetPinId = null;
                    let explicitPinName = null;
                    
                    const spaceMatch = trimmedL.match(/^([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)/);
                    if (spaceMatch) {
                        targetName = spaceMatch[1];
                        targetPinId = spaceMatch[2];
                    } else {
                        const dotMatch = trimmedL.match(/^([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)/);
                        if (dotMatch) {
                            targetName = dotMatch[1];
                            explicitPinName = dotMatch[2];
                        } else {
                            targetName = trimmedL;
                        }
                    }

                    if (targetName) {
                        let globalKey = targetName;
                        if (nodeLookup[graphName] && nodeLookup[graphName][targetName]) {
                            globalKey = nodeLookup[graphName][targetName];
                        }
                        
                        let finalPinName = explicitPinName;
                        if (!finalPinName && targetPinId && pinIdToName[targetPinId]) {
                            finalPinName = pinIdToName[targetPinId];
                        }

                        return { nodeKey: globalKey, pinName: finalPinName };
                    }
                    return null;
                }).filter(l => l !== null);
            }

            if (isExec) {
                if (isOutput) {
                    hasExecOut = true;
                    linkedNodes.forEach((target) => {
                        const exists = execOutLinks.find(l => l.pinName === pinName && l.targetNode === target.nodeKey);
                        if (!exists) {
                            execOutLinks.push({ pinName, targetNode: target.nodeKey });
                        }
                    });
                } else {
                    hasExecIn = true;
                }
            } else {
                if (!isOutput && !isHidden && pinName !== "execute") {
                    if (linkedNodes.length > 0) {
                        dataInLinks.push({ 
                            pinName, 
                            type: pinCategory, 
                            targetNode: linkedNodes[0].nodeKey,
                            targetPinName: linkedNodes[0].pinName
                        });
                    } else if (pinName !== "then") {
                        let textMatch = pinData.match(/DefaultTextValue=NSLOCTEXT\("[^"]+",\s*"[^"]+",\s*"([^"]+)"\)/);
                        let objMatch = pinData.match(/DefaultObject="[^"]*\/([^\/"]+)"/);
                        let valMatch = pinData.match(/DefaultValue="([^"]+)"/);
                        let autoValMatch = pinData.match(/AutogeneratedDefaultValue="([^"]+)"/);
                        
                        let val = "";
                        if (textMatch) val = textMatch[1];
                        else if (objMatch) val = objMatch[1];
                        else if (valMatch) val = valMatch[1];
                        else if (autoValMatch) val = autoValMatch[1];

                        if (val !== "") {
                            variables.push({ pinName, type: pinCategory, value: val });
                        }
                    }
                } else if (isOutput && !isHidden && pinCategory !== "exec") {
                    dataOutPins.push({ pinName, type: pinCategory });
                }
            }
        });

        const commentMatch = blockContent.match(/NodeComment="([^"]+)"/);
        let isComment = className === "EdGraphNode_Comment";
        let commentText = commentMatch ? commentMatch[1] : null;

        let isPure = !isComment && !hasExecIn && !hasExecOut &&
            className !== "K2Node_Event" && className !== "K2Node_CustomEvent" &&
            className !== "Function Entry" && className !== "Return Node" &&
            className !== "K2Node_InputKey" && className !== "Macro";

        let isEvent = (!isComment && !hasExecIn && hasExecOut) || className.includes("Event") || className.includes("InputKey");

        nodes[nodeObj.key] = { className, memberName, isComment, commentText, isPure, isEvent, execOutLinks, dataInLinks, dataOutPins, variables, graphName, name };
    });

    // 4. FORMATTER
    const groupedGraphs = {};
    for (const [nodeKey, data] of Object.entries(nodes)) {
        if (!groupedGraphs[data.graphName]) groupedGraphs[data.graphName] = {};
        groupedGraphs[data.graphName][nodeKey] = data;
    }

    // Helper to get unique descriptor
    function getDescriptor(nodeObj) {
        if (!nodeObj) return "Unknown";
        const suffixMatch = nodeObj.name.match(/_(\d+)$/);
        const suffix = suffixMatch ? `_${suffixMatch[1]}` : "";
        return (nodeObj.memberName ? nodeObj.memberName : nodeObj.className) + suffix;
    }

    function formatNodeInline(nodeKey, visited = new Set()) {
        if (visited.has(nodeKey)) return `[Circular Ref]`;
        visited.add(nodeKey);

        const node = nodes[nodeKey];
        if (!node) {
            visited.delete(nodeKey);
            return `[Unknown Node]`;
        }

        let descriptor = getDescriptor(node);
        let inputs = [];

        node.variables.forEach((v) => inputs.push(`${v.pinName}=${v.value}`));
        node.dataInLinks.forEach((dl) => {
            if (nodes[dl.targetNode] && nodes[dl.targetNode].isPure) {
                let pureInline = formatNodeInline(dl.targetNode, visited);
                if (dl.targetPinName && dl.targetPinName !== "ReturnValue" && dl.targetPinName !== "UnknownPin" && dl.targetPinName !== "None") {
                    pureInline = `${pureInline}.${dl.targetPinName}`;
                }
                inputs.push(`${dl.pinName}=${pureInline}`);
            } else {
                let targetDesc = nodes[dl.targetNode] ? getDescriptor(nodes[dl.targetNode]) : dl.targetNode;
                let pinSuffix = (dl.targetPinName && dl.targetPinName !== "ReturnValue" && dl.targetPinName !== "UnknownPin" && dl.targetPinName !== "None") ? `.${dl.targetPinName}` : "";
                inputs.push(`${dl.pinName}=[${targetDesc}${pinSuffix}]`);
            }
        });

        visited.delete(nodeKey);
        return inputs.length > 0 ? `${descriptor}(${inputs.join(", ")})` : `${descriptor}()`;
    }

    let resultString = `=== ASSET SUMMARY ===\nAsset Name: ${assetName}\nType: ${assetType}\n=====================\n\n`;

    for (const [gName, graphNodes] of Object.entries(groupedGraphs)) {
        resultString += `### GRAPH: ${gName}\n---\n`;

        let comments = Object.values(graphNodes).filter((n) => n.isComment && n.commentText && n.commentText !== "null");
        if (comments.length > 0) {
            comments.forEach((c) => { resultString += ` 📝 "${c.commentText}"\n`; });
            resultString += "\n";
        }

        for (const [nodeKey, data] of Object.entries(graphNodes)) {
            if (data.isComment || data.isPure) continue;
            if (nodeKey.includes("BTTask_") || nodeKey.includes("BTDecorator_") || nodeKey.includes("BTService_")) continue;

            const descriptor = getDescriptor(data);
            if (data.isEvent || data.className === "Function Entry") {
                resultString += `⚡ [${data.className.toUpperCase()}: ${descriptor}]\n`;
            } else {
                resultString += `[${descriptor}]\n`;
            }

            data.variables.forEach((v) => {
                let typeStr = v.type !== "unknown" ? `(${v.type}) ` : "";
                resultString += `  • [Variable] ${typeStr}${v.pinName} = ${v.value}\n`;
            });

            data.dataInLinks.forEach((dl) => {
                let typeStr = dl.type !== "unknown" ? `(${dl.type}) ` : "";
                if (nodes[dl.targetNode] && nodes[dl.targetNode].isPure) {
                    let pureInline = formatNodeInline(dl.targetNode);
                    if (dl.targetPinName && dl.targetPinName !== "ReturnValue" && dl.targetPinName !== "UnknownPin" && dl.targetPinName !== "None") {
                        pureInline = `${pureInline}.${dl.targetPinName}`;
                    }
                    resultString += `  • [Input Link] ${typeStr}${dl.pinName} <- ${pureInline}\n`;
                } else {
                    let targetDesc = nodes[dl.targetNode] ? getDescriptor(nodes[dl.targetNode]) : dl.targetNode;
                    let pinSuffix = (dl.targetPinName && dl.targetPinName !== "ReturnValue" && dl.targetPinName !== "UnknownPin" && dl.targetPinName !== "None") ? `.${dl.targetPinName}` : "";
                    resultString += `  • [Input Link] ${typeStr}${dl.pinName} <- receives from [${targetDesc}${pinSuffix}]\n`;
                }
            });

            data.dataOutPins.forEach((outPin) => {
                let typeStr = outPin.type !== "unknown" ? `(${outPin.type}) ` : "";
                resultString += `  • [Output] ${typeStr}${outPin.pinName}\n`;
            });

            if (data.execOutLinks.length === 0 && data.variables.length === 0 && data.dataInLinks.length === 0 && data.dataOutPins.length === 0) {
                resultString += `  -> (End of Flow)\n\n`;
            } else {
                data.execOutLinks.forEach((link) => {
                    let targetDesc = nodes[link.targetNode] ? getDescriptor(nodes[link.targetNode]) : link.targetNode;
                    
                    let printPinName = link.pinName;
                    if (data.className === "Branch") {
                        if (printPinName === "then") printPinName = "True";
                        if (printPinName === "else") printPinName = "False";
                    }
                    
                    let pinLabel = (printPinName !== "then" && printPinName !== "execute" && printPinName !== "OutputDelegate") ? ` (${printPinName})` : "";
                    resultString += `  ->${pinLabel} Connects to: [${targetDesc}]\n`;
                });
                if (data.execOutLinks.length === 0) {
                    resultString += `  -> (End of Flow)\n`;
                }
                resultString += `\n`;
            }
        }
    }

    return resultString.trim() || "Nodes parsed, but an error occurred during formatting.";
}

