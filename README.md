# Blueprint Flow Analyzer for Unreal Engine

A lightweight, client-side web utility that translates copied Unreal Engine 5 Blueprint graph nodes (T3D text format) into human-readable, structured pseudo-code. Perfect for documenting workflows, sharing logic with non-Unreal developers, or debugging node connections in text form.

## Features

- **T3D Syntax Parser**: Automatically processes copy-pasted Unreal Engine node blocks (`Begin Object ... End Object`).
- **Execution Flow Tracking**: Maps outgoing execution pins to their target nodes to visualize logic pathways.
- **Data Dependency Parsing**: Identifies incoming data links, showing exactly which node supplies data to each pin.
- **Static Input Extraction**: Reads literal values (strings, numbers, objects, and enums) directly configured inside the node inputs, including implicit "Self" target fallback pins.
- **Zero Dependencies**: Built with pure HTML5, CSS3, and Vanilla JavaScript—no build tools, node packages, or frameworks required.
- **One-Click Export**: Easily copy the generated pseudo-code to your clipboard for documentation, code reviews, or notes.

## Live Demo & Usage

### 🚀 Try It Online
You can easily host this page using **GitHub Pages**. Simply enable it under your repository settings (`Settings` -> `Pages` -> `Source: Deploy from branch`).

### 🛠️ How to Use
1. **In Unreal Engine**: Select the Blueprint nodes you want to analyze and press `Ctrl + C` (this copies their underlying text representation to your system clipboard).
2. **In the Analyzer**: Paste the copied text into the **Raw Blueprint Text** area.
3. **Analyze**: Click **Analyze Workflow**.
4. **Export**: Review the generated representation and click **Copy to Clipboard** to save it.

### Example Output
For a set of connected nodes, the parser translates complex T3D definitions into a readable outline:

```text
[K2Node_CallFunction_0: PrintString]
  • [Variable] InString = "Hello from Unreal Engine!"
  • [Input Link] Target <- receives from [Self]
  -> Connects to: [K2Node_CallFunction_1: DestroyActor]

[K2Node_CallFunction_1: DestroyActor]
  • [Input Link] Target <- receives from [CharacterMovement_0]
  -> (Isolated Flow / No Outgoing Connection)
```

## Running Locally

Since this is a static single-page application, you can run it directly:

1. Clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/unreal-engine-node-clipboard-parser.git
   ```
2. Navigate to the project folder and open `index.html` in any modern web browser:
   ```bash
   cd unreal-engine-node-clipboard-parser
   # Double click index.html or open it via terminal:
   xdg-open index.html # Linux
   open index.html     # macOS
   start index.html    # Windows
   ```

## License

This project is open-source and available under the [MIT License](LICENSE).
