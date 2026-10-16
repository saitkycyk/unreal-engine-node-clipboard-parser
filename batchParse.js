const fs = require('fs');
const path = require('path');
const myBlueprintParser = require('./myAdvancedParser.js');

function processBlueprints() {
    const projectRootParent = path.resolve(__dirname, '../../../../');

    // 1. Directory Definitions
    const baseDir = path.join(projectRootParent, 'Nightclub_Parsed_Blueprints');
    const inputDir = path.join(baseDir, 'Raw_T3D');

    // NEW: Define the dedicated folder for the Master Architecture
    const masterDir = path.join(baseDir, 'Master_Architecture');

    // The individual .md files will still go to the base directory
    const outputDir = baseDir;

    if (!fs.existsSync(inputDir)) {
        console.error(`Input directory does not exist! Searched at: ${inputDir}`);
        return;
    }

    // NEW: Create the Master Architecture folder if it doesn't exist
    if (!fs.existsSync(masterDir)) {
        console.log(`Creating Master Architecture directory: ${masterDir}`);
        fs.mkdirSync(masterDir);
    }

    fs.readdir(inputDir, (err, files) => {
        if (err) {
            return console.error('Unable to scan directory: ' + err);
        }

        let processedCount = 0;

        let masterDocument = "# Nightclub Simulator - Master Blueprint Architecture\n\n";
        masterDocument += "> This file contains the complete, parsed visual scripting logic for the entire game, optimized for LLM context window ingestion.\n\n";

        files.forEach((file) => {
            if (path.extname(file) === '.t3d') {
                const inputFilePath = path.join(inputDir, file);
                const rawT3DText = fs.readFileSync(inputFilePath, 'utf8');

                try {
                    const markdownOutput = myBlueprintParser.parseT3DToMarkdown(rawT3DText);

                    const outputFileName = file.replace('.t3d', '.md');
                    const outputFilePath = path.join(outputDir, outputFileName);
                    fs.writeFileSync(outputFilePath, markdownOutput);

                    masterDocument += `## File: ${outputFileName}\n\n`;
                    masterDocument += markdownOutput;
                    masterDocument += `\n\n---\n\n`;

                    console.log(`Successfully converted: ${outputFileName}`);
                    processedCount++;
                } catch (error) {
                    console.error(`\n[!] FAILED to parse ${file}. Error: ${error.message}`);
                }
            }
        });

        // NEW: Save the final monolithic file inside its dedicated folder
        const masterFilePath = path.join(masterDir, 'Nightclub_Master_Architecture.md');
        fs.writeFileSync(masterFilePath, masterDocument);

        console.log(`\nDONE! Translated ${processedCount} Blueprints.`);
        console.log(`Successfully generated the monolithic AI file in: Master_Architecture folder`);
    });
}

processBlueprints();