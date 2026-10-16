// Delegate to script.js as the single source of truth for Blueprint parsing
const { parseT3DToMarkdown } = require('./script.js');

module.exports = { parseT3DToMarkdown };