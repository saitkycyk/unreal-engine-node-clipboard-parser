# Blueprint Flow Analyzer for Unreal Engine

**Live Demo:** [https://saitkycyk.github.io/unreal-engine-node-clipboard-parser/](https://saitkycyk.github.io/unreal-engine-node-clipboard-parser/)

A lightweight, high-performance utility that translates Unreal Engine 5 Blueprint graph nodes (T3D text format) into human-readable, structured pseudo-code optimized for documentation, code reviews, and LLM context window ingestion.

---

## Features

- **Sequential Execution Flow Traversal**: Follows logic chains sequentially starting from root entry points (`Event`, `CustomEvent`, `FunctionEntry`, `EnhancedInputAction`), preserving logical branching paths (`Branch [True/False]`, `Sequence [Then 0, Then 1]`, `Cast [Success/Failed]`).
- **Automatic Reroute Knot (`K2Node_Knot`) Collapsing**: Transparently bypasses and removes cluttering reroute nodes, connecting inputs directly to their true source/target.
- **Mangled Struct & GUID Sanitization**: Automatically strips internal Unreal 32-character hex hashes (e.g. `ItemFee_5_D4AE914D...` → `ItemFee`), reducing LLM token consumption by over 40%.
- **Asset Summary & Blueprint Metadata**: Extracts top-level Blueprint metadata including Parent Class, Member Variables (with types and container specifiers), Function Graphs, and Event Dispatchers.
- **Modern UE 5.4 - 5.6+ Node Recognition**:
  - `K2Node_PromotableOperator`: Displays readable math/comparison symbols (`+`, `-`, `*`, `/`, `==`, `!=`, `<`, `>`, `AND`, `OR`).
  - `K2Node_EnhancedInputAction`: Resolves actual input action assets (e.g. `⚡ [INPUT ACTION: IA_Jump]`).
  - `K2Node_ComponentBoundEvent`: Maps component delegates (e.g. `⚡ [COMPONENT EVENT: Box.OnComponentBeginOverlap]`).
  - `K2Node_DynamicCast`: Displays `[Cast To ClassName]` with `Success` and `Cast Failed` pathways.
  - `K2Node_SpawnActorFromClass` & `K2Node_CreateWidget`: Directly extracts the spawned class or widget name.
- **Recursive Pure Node Inlining**: Automatically collapses complex mathematical trees, variable getters, and struct breaks into clean functional expressions (e.g. `Subtract(A=CurrentMoney, B=ItemFee)`).
- **Dual Runtime Support**: Operates as a zero-dependency client-side web application in any browser AND as a CommonJS Node.js module for batch automated pipelines.
- **Full Project Batch Pipeline**: Includes `ExportBlueprints.py` (for automated in-editor T3D batch exporting) and `batchParse.js` (for translating entire project directories into Markdown and building a monolithic architecture document).

---

## Live Demo & Usage

### 🚀 Web Interface
You can use the browser-based analyzer directly at: [https://saitkycyk.github.io/unreal-engine-node-clipboard-parser/](https://saitkycyk.github.io/unreal-engine-node-clipboard-parser/)

1. **In Unreal Engine**: Select any Blueprint or Behavior Tree nodes and press `Ctrl + C`.
2. **In the Analyzer**: Paste the copied text into **Raw Node Data**.
3. **Analyze**: Click **Analyze**.
4. **Copy**: Click **Copy** to grab clean Markdown pseudo-code.

---

## Batch Processing & Automation

### 1. In-Editor Blueprint Export (`ExportBlueprints.py`)
Run inside Unreal Engine Editor via the Python console or an Editor Utility Widget:
```python
# Automatically exports project blueprints to Raw_T3D and runs batchParse.js
import ExportBlueprints
ExportBlueprints.export_nightclub_blueprints()
```

### 2. Node.js Batch Parsing (`batchParse.js`)
Convert an entire folder of `.t3d` exports into individual `.md` files and generate a combined `Master_Architecture.md`:
```bash
# Uses default project paths or custom directory arguments
node batchParse.js [inputRawT3DDirectory] [outputMarkdownDirectory]
```

---

## Example Output

```markdown
=== ASSET SUMMARY ===
Asset Name: AC_BankAndShop
Type: Blueprint
Parent Class: ActorComponent

Variables:
  • (struct: S_TransactionsDetails [Array]) TransactionsList
  • (real) CurrentMoney
  • (text) LoginUsername
  • (mcdelegate) ItemAdded
=====================

### GRAPH: EventGraph
---
⚡ [CUSTOM EVENT: BuyItem_0]
  • [Output] (delegate) OutputDelegate
  • [Output] (name) ItemRow
  -> Connects to: [K2Node_GetDataTableRow_0]

[K2Node_GetDataTableRow_0]
  • [Variable] (object) DataTable = DT_ShoppingItemList
  • [Input Link] (name) RowName <- receives from [BuyItem_0.ItemRow]
  • [Output] (struct) ReturnValue
  -> Connects to: [CurrentMoney_0]

[CurrentMoney_0]
  • [Input Link] (real) CurrentMoney <- -(A=CurrentMoney, B=[K2Node_BreakStruct_0.ItemFee])
  -> Connects to: [AddNewTransactions_4]
```

---

## License

This project is open-source and available under the [MIT License](LICENSE).
