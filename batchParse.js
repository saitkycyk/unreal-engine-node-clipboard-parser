const fs = require('fs');
const path = require('path');
const { parseT3DToMarkdown } = require('./script.js');

function processBlueprints() {
    // 1. Resolve base directory from CLI args, env var, or fallback locations
    let defaultBaseDir = 'F:/Unreal Engine Projects/Nightclub_Parsed_Blueprints';
    if (!fs.existsSync(defaultBaseDir)) {
        defaultBaseDir = path.resolve(__dirname, '../../../../Nightclub_Parsed_Blueprints');
    }

    const baseDir = process.argv[2] ? path.resolve(process.argv[2]) : defaultBaseDir;
    const inputDir = path.join(baseDir, 'Raw_T3D');
    const masterDir = path.join(baseDir, 'Master_Architecture');
    const outputDir = process.argv[3] ? path.resolve(process.argv[3]) : baseDir;

    console.log(`\n=== Unreal Engine Blueprint Batch Parser ===`);
    console.log(`Input Directory (Raw T3D): ${inputDir}`);
    console.log(`Output Directory (.md):    ${outputDir}`);
    console.log(`Master Doc Directory:      ${masterDir}\n`);

    if (!fs.existsSync(inputDir)) {
        console.error(`[!] Input directory does not exist! Searched at: ${inputDir}`);
        console.error(`Usage: node batchParse.js [baseOrInputDir] [outputDir]`);
        return;
    }

    if (!fs.existsSync(masterDir)) {
        console.log(`Creating Master Architecture directory: ${masterDir}`);
        fs.mkdirSync(masterDir, { recursive: true });
    }

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.readdir(inputDir, (err, files) => {
        if (err) {
            return console.error('Unable to scan directory: ' + err);
        }

        const t3dFiles = files.filter(f => path.extname(f).toLowerCase() === '.t3d');
        console.log(`Found ${t3dFiles.length} T3D Blueprint files to parse...`);

        let processedCount = 0;
        let masterDocument = "# Nightclub Simulator - Master Blueprint Architecture\n\n";
        masterDocument += "> This file contains the complete, parsed visual scripting logic for the entire game, optimized for LLM context window ingestion.\n\n";

        t3dFiles.forEach((file) => {
            const inputFilePath = path.join(inputDir, file);
            const rawT3DText = fs.readFileSync(inputFilePath, 'utf8');

            try {
                const markdownOutput = parseT3DToMarkdown(rawT3DText);

                const outputFileName = file.replace(/\.t3d$/i, '.md');
                const outputFilePath = path.join(outputDir, outputFileName);
                fs.writeFileSync(outputFilePath, markdownOutput);

                masterDocument += `## File: ${outputFileName}\n\n`;
                masterDocument += markdownOutput;
                masterDocument += `\n\n---\n\n`;

                processedCount++;
                if (processedCount % 10 === 0 || processedCount === t3dFiles.length) {
                    console.log(`Processed [${processedCount}/${t3dFiles.length}] blueprints...`);
                }
            } catch (error) {
                console.error(`\n[!] FAILED to parse ${file}. Error: ${error.message}`);
            }
        });

        // Save monolithic master architecture file
        const masterFilePath = path.join(masterDir, 'Nightclub_Master_Architecture.md');
        fs.writeFileSync(masterFilePath, masterDocument);

        console.log(`\n✅ DONE! Successfully translated ${processedCount} Blueprints.`);
        console.log(`📄 Generated Master Architecture file at: ${masterFilePath}\n`);
    });
}

if (require.main === module) {
    processBlueprints();
}

module.exports = { processBlueprints };