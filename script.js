document.addEventListener("DOMContentLoaded", () => {
  const inputArea = document.getElementById("bp-input");
  const outputArea = document.getElementById("bp-output");
  const analyzeBtn = document.getElementById("analyze-btn");
  const copyBtn = document.getElementById("copy-btn");

  // ---------------------------------------------------------
  // REGEX PATTERNS
  // ---------------------------------------------------------
  const regexObjectBlock = /Begin Object([\s\S]*?)End Object/g;
  const regexClass = /Class=(?:\/[^\/]+\/)*([^ ]+)/;
  const regexName = /Name="([^"]+)"/;
  const regexMemberName = /MemberName="([^"]+)"/;
  const regexCustomFunctionName = /CustomFunctionName="([^"]+)"/;
  const regexNodeComment = /NodeComment="([^"]+)"/;
  const regexPin = /CustomProperties Pin \(.*/g;

  // Pin Property Extraction
  const regexPinName = /PinName="([^"]+)"/;
  const regexIsOutput = /Direction="EGPD_Output"/;
  const regexPinCategory = /PinType\.PinCategory="([^"]+)"/;
  const regexPinSubCategoryObj =
    /PinType\.PinSubCategoryObject=[^\s]*?([^\/"]+)"/;
  const regexIsHidden = /bHidden=True/;
  const regexLinkedTo = /LinkedTo=\(([^)]+)\)/;

  // Value Extraction
  const regexDefaultValue = /DefaultValue="([^"]+)"/;
  const regexDefaultText =
    /DefaultTextValue=NSLOCTEXT\("[^"]+",\s*"[^"]+",\s*"([^"]+)"\)/;
  const regexDefaultObj = /DefaultObject="[^"]*\/([^\/"]+)"/;

  // Context Extraction
  const regexContext = /ExportPath="[^\"]+\/([^\/\.]+)\.[^\.]+:([^\.]+)\./;

  // Behavior Tree Extraction
  const regexDecorators = /Decorators=\(([^\)]+)\)/;
  const regexServices = /Services=\(([^\)]+)\)/;

  // ---------------------------------------------------------
  // PARSING LOGIC
  // ---------------------------------------------------------
  analyzeBtn.addEventListener("click", () => {
    const rawText = inputArea.value;
    if (!rawText.trim()) {
      outputArea.textContent =
        "Please paste some Blueprint or Behavior Tree text first.";
      return;
    }

    const nodes = {};
    const blocks = [...rawText.matchAll(regexObjectBlock)];

    if (blocks.length === 0) {
      outputArea.textContent =
        "No valid Unreal Engine nodes found. Ensure you copied full nodes.";
      return;
    }

    let assetName = "Unknown Asset";
    let graphName = "Unknown Graph";
    let assetType = "Blueprint";

    const firstBlockContext = blocks[0][0].match(regexContext);
    if (firstBlockContext) {
      assetName = firstBlockContext[1];
      graphName = firstBlockContext[2];
      if (blocks[0][0].includes("BehaviorTree")) {
        assetType = "Behavior Tree";
      }
    }

    // Pass 1: Parse all blocks and extract raw data
    blocks.forEach((match) => {
      const blockContent = match[0];

      const nameMatch = blockContent.match(regexName);
      const classMatch = blockContent.match(regexClass);
      const memberMatch = blockContent.match(regexMemberName);
      const customFuncMatch = blockContent.match(regexCustomFunctionName);
      const commentMatch = blockContent.match(regexNodeComment);

      const name = nameMatch ? nameMatch[1] : "Unknown_Node";
      let className = classMatch
        ? classMatch[1].split(".").pop()
        : "Unknown_Class";
      let memberName = memberMatch
        ? memberMatch[1]
        : customFuncMatch
          ? customFuncMatch[1]
          : null;

      if (className === "K2Node_IfThenElse") className = "Branch";
      if (className === "K2Node_DynamicCast") {
        className = "Cast";
        const castMatch = blockContent.match(/TargetType=".*?([^\/"]+)'"/);
        if (castMatch) memberName = `Cast To ${castMatch[1]}`;
      }
      if (className === "K2Node_Knot") className = "Reroute";
      if (className === "K2Node_ExecutionSequence") className = "Sequence";
      if (className === "K2Node_MacroInstance") {
        className = "Macro";
        const macroMatch = blockContent.match(/MacroGraphReference=\(.*MemberName="([^"]+)"/);
        if (macroMatch) memberName = macroMatch[1];
      }

      if (className.startsWith("BehaviorTreeGraphNode_")) {
        className = className.replace("BehaviorTreeGraphNode_", "BT_");
      }

      const execOutLinks = [];
      const dataInLinks = [];
      const variables = [];

      let hasExecIn = false;
      let hasExecOut = false;

      const decMatch = blockContent.match(regexDecorators);
      const srvMatch = blockContent.match(regexServices);

      if (decMatch) {
        const decorators = decMatch[1]
          .split(",")
          .filter((d) => d.trim() !== "");
        decorators.forEach((d) =>
          variables.push({
            pinName: "Decorator",
            type: "BT",
            value: d.split(" ")[0],
          }),
        );
      }
      if (srvMatch) {
        const services = srvMatch[1].split(",").filter((s) => s.trim() !== "");
        services.forEach((s) =>
          variables.push({
            pinName: "Service",
            type: "BT",
            value: s.split(" ")[0],
          }),
        );
      }

      const pinMatches = [...blockContent.matchAll(regexPin)];
      pinMatches.forEach((pinMatch) => {
        const pinData = pinMatch[0];

        const pinNameMatch = pinData.match(regexPinName);
        const pinName = pinNameMatch ? pinNameMatch[1] : "UnknownPin";

        const isOutput = regexIsOutput.test(pinData);
        const isHidden = regexIsHidden.test(pinData);

        const pinCategoryMatch = pinData.match(regexPinCategory);
        let pinCategory = pinCategoryMatch ? pinCategoryMatch[1] : "unknown";

        const subObjMatch = pinData.match(regexPinSubCategoryObj);
        if (subObjMatch && pinCategory === "object") {
          pinCategory = subObjMatch[1].replace(/_C|'/g, "");
        }

        const isExec = pinCategory === "exec";
        const linkMatch = pinData.match(regexLinkedTo);

        let linkedNodes = [];
        if (linkMatch) {
          const links = linkMatch[1].split(",");
          linkedNodes = links
            .map((l) => l.trim().split(" ")[0].split(".")[0].trim())
            .filter((l) => l !== "");
        }

        if (isExec) {
          if (isOutput) {
            hasExecOut = true;
            linkedNodes.forEach((target) => {
              if (!execOutLinks.includes(target)) execOutLinks.push(target);
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
                targetNode: linkedNodes[0],
              });
            } else if (pinName !== "then") {
              let textMatch = pinData.match(regexDefaultText);
              let objMatch = pinData.match(regexDefaultObj);
              let valMatch = pinData.match(regexDefaultValue);
              let val = "(Empty)";

              if (textMatch) val = `"${textMatch[1]}"`;
              else if (objMatch) val = objMatch[1].split(".").pop();
              else if (valMatch) val = valMatch[1];
              else if (pinName === "self") val = "(Implicit Self)";

              variables.push({ pinName, type: pinCategory, value: val });
            }
          }
        }
      });

      let isComment = className === "EdGraphNode_Comment";
      let commentText = commentMatch ? commentMatch[1] : null;

      // Pure if it's not a comment, not an event, not a macro, and has no exec pins at all
      let isPure =
        !isComment &&
        !hasExecIn &&
        !hasExecOut &&
        className !== "K2Node_Event" &&
        className !== "K2Node_CustomEvent" &&
        className !== "K2Node_InputKey" &&
        className !== "K2Node_MacroInstance";

      // Event if it has no exec in, but has exec out OR is specifically an event class
      let isEvent =
        (!isComment && !hasExecIn && hasExecOut) ||
        className.includes("Event") ||
        className.includes("InputKey");

      nodes[name] = {
        className,
        memberName,
        isComment,
        commentText,
        isPure,
        isEvent,
        execOutLinks,
        dataInLinks,
        variables,
      };
    });

    // Pass 2: Format the Output

    // Recursive function to format pure functions inline
    function formatNodeInline(nodeName, visited = new Set()) {
      if (visited.has(nodeName)) return `[Circular Ref: ${nodeName}]`;
      visited.add(nodeName);

      const node = nodes[nodeName];
      if (!node) return `[Unknown Node]`;

      let descriptor = node.memberName || node.className;

      let inputs = [];
      node.variables.forEach((v) => {
        inputs.push(`${v.pinName}=${v.value}`);
      });
      node.dataInLinks.forEach((dl) => {
        if (nodes[dl.targetNode] && nodes[dl.targetNode].isPure) {
          inputs.push(
            `${dl.pinName}=${formatNodeInline(dl.targetNode, visited)}`,
          );
        } else {
          let targetDesc = nodes[dl.targetNode]
            ? nodes[dl.targetNode].memberName || nodes[dl.targetNode].className
            : dl.targetNode;
          inputs.push(`${dl.pinName}=[${targetDesc}]`);
        }
      });

      visited.delete(nodeName);

      if (inputs.length > 0) {
        return `${descriptor}(${inputs.join(", ")})`;
      }
      return `${descriptor}()`;
    }

    let resultString = `=== ASSET SUMMARY ===\n`;
    resultString += `Asset Name: ${assetName}\n`;
    resultString += `Graph/Function: ${graphName}\n`;
    resultString += `Type: ${assetType}\n`;
    resultString += `=====================\n\n`;

    // 1. Comments
    let comments = Object.values(nodes).filter((n) => n.isComment);
    if (comments.length > 0) {
      resultString += `=== COMMENT BLOCKS ===\n`;
      comments.forEach((c) => {
        resultString += ` 📝 "${c.commentText}"\n`;
      });
      resultString += `======================\n\n`;
    }

    // 2. Main Nodes
    for (const [nodeName, data] of Object.entries(nodes)) {
      if (data.isComment) continue; // Handled above
      if (data.isPure) continue; // Handled inline

      if (
        nodeName.startsWith("BTTask_") ||
        nodeName.startsWith("BTDecorator_") ||
        nodeName.startsWith("BTService_")
      ) {
        continue;
      }

      const descriptor = data.memberName ? data.memberName : data.className;

      if (data.isEvent) {
        resultString += `⚡ [EVENT: ${descriptor}]\n`;
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
          resultString += `  • [Input Link] ${typeStr}${dl.pinName} <- ${formatNodeInline(dl.targetNode)}\n`;
        } else {
          let targetDesc = nodes[dl.targetNode]
            ? nodes[dl.targetNode].memberName || nodes[dl.targetNode].className
            : dl.targetNode;
          resultString += `  • [Input Link] ${typeStr}${dl.pinName} <- receives from [${targetDesc}]\n`;
        }
      });

      if (data.execOutLinks.length > 0) {
        data.execOutLinks.forEach((target) => {
          let targetDescriptor = target;
          if (nodes[target]) {
            const tNode = nodes[target];
            targetDescriptor = tNode.memberName
              ? tNode.memberName
              : tNode.className;
          }
          resultString += `  -> Connects to: [${targetDescriptor}]\n`;
        });
      } else {
        resultString += `  -> (End of Flow)\n`;
      }

      resultString += "\n";
    }

    outputArea.textContent =
      resultString.trim() ||
      "Nodes parsed, but an error occurred during formatting.";
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
