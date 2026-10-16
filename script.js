if (typeof document !== "undefined") {
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
}

function parseT3DToMarkdown(rawText) {
    if (!rawText || !rawText.trim()) return "No valid text provided.";

    const lines = rawText.split(/\r?\n/);
    const objects = {};
    const stack = [];

    let assetName = "Unknown Asset";
    let assetType = "Blueprint";
    let parentClass = "";
    const blueprintVariables = [];
    const functionGraphsList = [];
    const delegateSignaturesList = [];

    if (rawText.includes("BehaviorTree")) {
        assetType = "Behavior Tree";
    }

    // Helper: strip Unreal 32-character GUID hash from pin/var names
    function sanitizePinName(name) {
        if (!name) return "";
        return name.trim().replace(/_(\d+)_[A-F0-9]{32}$/i, "");
    }

    // Helper: clean struct literal values (e.g. Vector, Rotator, Color)
    function sanitizeDefaultValue(val) {
        if (!val) return "";
        const vecMatch = val.match(/^\(X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)\)$/);
        if (vecMatch) {
            return `Vector(${parseFloat(vecMatch[1])}, ${parseFloat(vecMatch[2])}, ${parseFloat(vecMatch[3])})`;
        }
        const rotMatch = val.match(/^\(Pitch=([-\d.]+),Yaw=([-\d.]+),Roll=([-\d.]+)\)$/);
        if (rotMatch) {
            return `Rotator(P=${parseFloat(rotMatch[1])}, Y=${parseFloat(rotMatch[2])}, R=${parseFloat(rotMatch[3])})`;
        }
        const colMatch = val.match(/^\(R=([-\d.]+),G=([-\d.]+),B=([-\d.]+),A=([-\d.]+)\)$/);
        if (colMatch) {
            return `Color(${parseFloat(colMatch[1])}, ${parseFloat(colMatch[2])}, ${parseFloat(colMatch[3])}, ${parseFloat(colMatch[4])})`;
        }
        return val;
    }

    // 1. AST STACK EXTRACTOR
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

            if (attrs.Class && (attrs.Class.includes("Engine.Blueprint") || attrs.Class.includes("WidgetBlueprint"))) {
                assetName = objName;
                if (attrs.Class.includes("WidgetBlueprint")) assetType = "Widget Blueprint";
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
                if (newObj.parentKey && (!objects[objKey].parentKey || objects[objKey].parentKey !== newObj.parentKey)) {
                    objects[objKey].parentKey = newObj.parentKey;
                }
            }

            stack.push(objects[objKey]);
        } else if (trimmed === "End Object") {
            stack.pop();
        } else {
            // Check top-level metadata lines outside or inside root
            if (stack.length <= 1) {
                const parentMatch = trimmed.match(/^ParentClass=".*?\.([^']+)'?"/);
                if (parentMatch && !parentClass) parentClass = parentMatch[1];

                const varMatch = trimmed.match(/^NewVariables\(\d+\)=\(VarName="([^"]+)",(?:.*?)VarType=\(([^)]+)\)/);
                if (varMatch) {
                    const vName = varMatch[1];
                    const vTypeInfo = varMatch[2];
                    const catMatch = vTypeInfo.match(/PinCategory="([^"]+)"/);
                    const subObjMatch = vTypeInfo.match(/PinSubCategoryObject=".*?\.([^']+)'?"/);
                    const containerMatch = vTypeInfo.match(/ContainerType=([a-zA-Z0-9_]+)/);

                    let vType = catMatch ? catMatch[1] : "unknown";
                    if (subObjMatch) vType = `${vType}: ${subObjMatch[1]}`;
                    if (containerMatch && containerMatch[1] !== "None") vType += ` [${containerMatch[1]}]`;

                    blueprintVariables.push({ name: vName, type: vType });
                }

                const fnGraphMatch = trimmed.match(/^FunctionGraphs\(\d+\)=".*?\.([^']+)'?"/);
                if (fnGraphMatch) functionGraphsList.push(fnGraphMatch[1]);

                const delegateMatch = trimmed.match(/^DelegateSignatureGraphs\(\d+\)=".*?\.([^']+)'?"/);
                if (delegateMatch) delegateSignaturesList.push(delegateMatch[1]);
            }

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

    // Extract all Pin IDs and their Names
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
                pinIdToName[pinIdMatch[1]] = sanitizePinName(pinNameMatch[1]);
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
            if (castMatch) {
                let cleanTarget = castMatch[1].split('.').pop().replace(/_C$/, "");
                memberName = `Cast To ${cleanTarget}`;
            }
        } else if (className === "K2Node_Event") {
            const evtName = blockContent.match(/EventSignatureName="([^"]+)"/);
            if (evtName) memberName = evtName[1];
        } else if (className === "K2Node_EnhancedInputAction") {
            const iaMatch = blockContent.match(/InputAction=".*?\.([^']+)'?"/) || blockContent.match(/DefaultValue="(IA_[^"]+)"/);
            if (iaMatch) memberName = iaMatch[1];
        } else if (className === "K2Node_ComponentBoundEvent") {
            const compMatch = blockContent.match(/ComponentPropertyName="([^"]+)"/);
            const delMatch = blockContent.match(/DelegatePropertyName="([^"]+)"/);
            if (compMatch && delMatch) memberName = `${compMatch[1]}.${delMatch[1]}`;
            else if (delMatch) memberName = delMatch[1];
        }

        // Modern Promotable Operator recognition (UE 5.0 - 5.6+)
        if (className === "K2Node_PromotableOperator") {
            const opMatch = blockContent.match(/OperationName="([^"]+)"/);
            if (opMatch) {
                const op = opMatch[1];
                const opSymbols = {
                    "Add": "+", "Subtract": "-", "Multiply": "*", "Divide": "/",
                    "EqualEqual": "==", "NotEqual": "!=", "Greater": ">", "GreaterEqual": ">=",
                    "Less": "<", "LessEqual": "<=", "BooleanAND": "AND", "BooleanOR": "OR",
                    "BooleanXOR": "XOR", "BooleanNOT": "NOT"
                };
                memberName = opSymbols[op] || op;
            }
        }

        // Spawn Actor / Create Widget class name extraction
        if (className === "K2Node_SpawnActorFromClass") {
            const classMatch = blockContent.match(/ActorClass=".*?\.([^']+)'?"/);
            if (classMatch) memberName = `SpawnActor: ${classMatch[1]}`;
        } else if (className === "K2Node_CreateWidget") {
            const widgetMatch = blockContent.match(/WidgetClass=".*?\.([^']+)'?"/);
            if (widgetMatch) memberName = `CreateWidget: ${widgetMatch[1]}`;
        } else if (className === "K2Node_Select") {
            memberName = "Select";
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
            const rawPinName = pinNameMatch ? pinNameMatch[1] : "UnknownPin";
            const pinName = sanitizePinName(rawPinName);

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

                        let finalPinName = explicitPinName ? sanitizePinName(explicitPinName) : null;
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

                        let val = "(Empty)";
                        if (textMatch) val = `"${textMatch[1]}"`;
                        else if (objMatch) val = objMatch[1].split(".").pop();
                        else if (valMatch) val = sanitizeDefaultValue(valMatch[1]);
                        else if (autoValMatch) val = sanitizeDefaultValue(autoValMatch[1]);
                        else if (pinName === "self") val = "(Implicit Self)";

                        if (val !== "(Empty)" && val !== '""' && val !== "None") {
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

        let isReroute = className === "Reroute";

        let isPure = !isComment && !isReroute && !hasExecIn && !hasExecOut &&
            className !== "K2Node_Event" && className !== "K2Node_CustomEvent" &&
            className !== "Function Entry" && className !== "Return Node" &&
            className !== "K2Node_InputKey" && className !== "K2Node_EnhancedInputAction" &&
            className !== "K2Node_ComponentBoundEvent" && className !== "Macro";

        let isEvent = (!isComment && !isReroute && !hasExecIn && hasExecOut) ||
            className.includes("Event") || className.includes("InputKey") ||
            className === "K2Node_EnhancedInputAction" || className === "K2Node_ComponentBoundEvent";

        nodes[nodeObj.key] = {
            className,
            memberName,
            isComment,
            commentText,
            isReroute,
            isPure,
            isEvent,
            execOutLinks,
            dataInLinks,
            dataOutPins,
            variables,
            graphName,
            name
        };
    });

    // 3.5 RESOLVE REROUTE KNOTS (Bypass K2Node_Knot)
    function resolveKnotTarget(targetKey, pinName, visited = new Set()) {
        if (!targetKey || visited.has(targetKey)) return { targetKey, pinName };
        visited.add(targetKey);
        const node = nodes[targetKey];
        if (!node || !node.isReroute) return { targetKey, pinName };
        if (node.execOutLinks.length > 0) {
            return resolveKnotTarget(node.execOutLinks[0].targetNode, node.execOutLinks[0].pinName || pinName, visited);
        }
        return { targetKey, pinName };
    }

    function resolveKnotSource(sourceKey, pinName, visited = new Set()) {
        if (!sourceKey || visited.has(sourceKey)) return { sourceKey, pinName };
        visited.add(sourceKey);
        const node = nodes[sourceKey];
        if (!node || !node.isReroute) return { sourceKey, pinName };
        if (node.dataInLinks.length > 0) {
            return resolveKnotSource(node.dataInLinks[0].targetNode, node.dataInLinks[0].targetPinName || pinName, visited);
        }
        return { sourceKey, pinName };
    }

    // Bypass knots in all execOutLinks and dataInLinks
    for (const [key, node] of Object.entries(nodes)) {
        if (node.isReroute) continue;

        node.execOutLinks.forEach(link => {
            const resolved = resolveKnotTarget(link.targetNode, link.pinName);
            link.targetNode = resolved.targetKey;
        });

        node.dataInLinks.forEach(link => {
            const resolved = resolveKnotSource(link.targetNode, link.targetPinName);
            link.targetNode = resolved.sourceKey;
            link.targetPinName = resolved.pinName;
        });
    }

    // 4. FORMATTER & FLOW TRAVERSAL
    const groupedGraphs = {};
    for (const [nodeKey, data] of Object.entries(nodes)) {
        if (!groupedGraphs[data.graphName]) groupedGraphs[data.graphName] = {};
        groupedGraphs[data.graphName][nodeKey] = data;
    }

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

        // Exclude redundant (Implicit Self) from inline pure function calls
        node.variables.forEach((v) => {
            if (v.pinName === "self" && v.value === "(Implicit Self)") return;
            inputs.push(`${v.pinName}=${v.value}`);
        });

        node.dataInLinks.forEach((dl) => {
            if (dl.pinName === "self" && !nodes[dl.targetNode]) return;
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

    // Format single node details
    function formatNodeBlock(nodeKey, data) {
        let out = "";
        const descriptor = getDescriptor(data);

        if (data.isEvent || data.className === "Function Entry") {
            let label = data.className;
            if (data.className === "K2Node_Event") label = "EVENT";
            else if (data.className === "K2Node_CustomEvent") label = "CUSTOM EVENT";
            else if (data.className === "K2Node_ComponentBoundEvent") label = "COMPONENT EVENT";
            else if (data.className === "K2Node_EnhancedInputAction") label = "INPUT ACTION";
            else if (data.className === "K2Node_InputKey") label = "INPUT KEY";
            else if (data.className === "Function Entry") label = "FUNCTION ENTRY";
            else label = data.className.toUpperCase();

            out += `⚡ [${label}: ${descriptor}]\n`;
        } else {
            out += `[${descriptor}]\n`;
        }

        data.variables.forEach((v) => {
            let typeStr = v.type !== "unknown" ? `(${v.type}) ` : "";
            out += `  • [Variable] ${typeStr}${v.pinName} = ${v.value}\n`;
        });

        data.dataInLinks.forEach((dl) => {
            let typeStr = dl.type !== "unknown" ? `(${dl.type}) ` : "";
            if (nodes[dl.targetNode] && nodes[dl.targetNode].isPure) {
                let pureInline = formatNodeInline(dl.targetNode);
                if (dl.targetPinName && dl.targetPinName !== "ReturnValue" && dl.targetPinName !== "UnknownPin" && dl.targetPinName !== "None") {
                    pureInline = `${pureInline}.${dl.targetPinName}`;
                }
                out += `  • [Input Link] ${typeStr}${dl.pinName} <- ${pureInline}\n`;
            } else {
                let targetDesc = nodes[dl.targetNode] ? getDescriptor(nodes[dl.targetNode]) : dl.targetNode;
                let pinSuffix = (dl.targetPinName && dl.targetPinName !== "ReturnValue" && dl.targetPinName !== "UnknownPin" && dl.targetPinName !== "None") ? `.${dl.targetPinName}` : "";
                out += `  • [Input Link] ${typeStr}${dl.pinName} <- receives from [${targetDesc}${pinSuffix}]\n`;
            }
        });

        data.dataOutPins.forEach((outPin) => {
            let typeStr = outPin.type !== "unknown" ? `(${outPin.type}) ` : "";
            out += `  • [Output] ${typeStr}${outPin.pinName}\n`;
        });

        if (data.execOutLinks.length === 0 && data.variables.length === 0 && data.dataInLinks.length === 0 && data.dataOutPins.length === 0) {
            out += `  -> (End of Flow)\n\n`;
        } else {
            data.execOutLinks.forEach((link) => {
                let targetDesc = nodes[link.targetNode] ? getDescriptor(nodes[link.targetNode]) : link.targetNode;

                let printPinName = link.pinName;
                if (data.className === "Branch") {
                    if (printPinName === "then") printPinName = "True";
                    if (printPinName === "else") printPinName = "False";
                } else if (data.className === "K2Node_DynamicCast") {
                    if (printPinName === "then") printPinName = "Success";
                    if (printPinName === "CastFailed") printPinName = "Cast Failed";
                }

                let pinLabel = (printPinName !== "then" && printPinName !== "execute" && printPinName !== "OutputDelegate") ? ` (${printPinName})` : "";
                out += `  ->${pinLabel} Connects to: [${targetDesc}]\n`;
            });
            if (data.execOutLinks.length === 0) {
                out += `  -> (End of Flow)\n`;
            }
            out += `\n`;
        }

        return out;
    }

    // 5. ASSEMBLE OUTPUT
    let resultString = `=== ASSET SUMMARY ===\n`;
    resultString += `Asset Name: ${assetName}\n`;
    resultString += `Type: ${assetType}\n`;
    if (parentClass) resultString += `Parent Class: ${parentClass}\n`;

    if (blueprintVariables.length > 0) {
        resultString += `\nVariables:\n`;
        blueprintVariables.forEach(v => {
            resultString += `  • (${v.type}) ${v.name}\n`;
        });
    }

    if (functionGraphsList.length > 0) {
        resultString += `\nFunctions:\n`;
        functionGraphsList.forEach(fn => {
            resultString += `  • ${fn}\n`;
        });
    }

    if (delegateSignaturesList.length > 0) {
        resultString += `\nEvent Dispatchers:\n`;
        delegateSignaturesList.forEach(disp => {
            resultString += `  • ${disp}\n`;
        });
    }

    resultString += `=====================\n\n`;

    for (const [gName, graphNodes] of Object.entries(groupedGraphs)) {
        resultString += `### GRAPH: ${gName}\n---\n`;

        // Render comment nodes
        let comments = Object.values(graphNodes).filter((n) => n.isComment && n.commentText && n.commentText !== "null");
        if (comments.length > 0) {
            comments.forEach((c) => { resultString += ` 📝 "${c.commentText}"\n`; });
            resultString += "\n";
        }

        // Ordered flow: First find entry points
        const visitedNodes = new Set();
        const nonPureNodes = Object.entries(graphNodes).filter(([_, n]) => !n.isComment && !n.isPure && !n.isReroute);

        // Entry points: events or function entry
        const entryNodes = nonPureNodes.filter(([_, n]) => n.isEvent || n.className === "Function Entry");
        // Secondary entry points: non-pure nodes with execOut but no execIn
        const otherEntries = nonPureNodes.filter(([key, n]) => !entryNodes.some(([ek]) => ek === key) && n.execOutLinks.length > 0 && n.dataInLinks.length === 0);

        const orderedRoots = [...entryNodes, ...otherEntries];

        // Walk flow from each root
        function walkExecutionFlow(nodeKey) {
            if (visitedNodes.has(nodeKey)) return;
            visitedNodes.add(nodeKey);

            const data = nodes[nodeKey];
            if (!data || data.isComment || data.isPure || data.isReroute) return;

            resultString += formatNodeBlock(nodeKey, data);

            // Recursively follow outgoing execution links
            data.execOutLinks.forEach(link => {
                if (link.targetNode && graphNodes[link.targetNode]) {
                    walkExecutionFlow(link.targetNode);
                }
            });
        }

        orderedRoots.forEach(([key]) => walkExecutionFlow(key));

        // Any remaining non-pure nodes not visited during flow traversal (isolated/unconnected logic)
        const unvisited = nonPureNodes.filter(([key]) => !visitedNodes.has(key));
        if (unvisited.length > 0) {
            resultString += `#### Other / Unconnected Logic\n\n`;
            unvisited.forEach(([key, data]) => {
                resultString += formatNodeBlock(key, data);
            });
        }
    }

    return resultString.trim() || "Nodes parsed, but an error occurred during formatting.";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseT3DToMarkdown };
}
