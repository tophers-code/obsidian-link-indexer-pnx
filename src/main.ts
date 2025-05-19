import deepmerge from 'deepmerge';
import picomatch from 'picomatch';
import { Plugin, PluginSettingTab, Setting, Vault, normalizePath, TFile, getLinkpath, ReferenceCache, Notice } from 'obsidian';

interface IndexNode {
  count: number;
  link: string;
  originalLinks: string[]; // Store original link variations
  displayName: string; // Clean display name
}

export default class LinkIndexer extends Plugin {
  settings: LinkIndexerSettings;
  vault: Vault;
  globalExcludes: string[];
  registeredCommandIds: string[] = [];

  onInit() {}

  async onload() {
    // Initialize settings first with defaults
    this.settings = new LinkIndexerSettings();
    
    // Now safe to use logging
    this.log("Plugin loading...");
    
    const loadedSettings = await this.loadData();
    if (loadedSettings) {
      this.log("Loaded settings:", loadedSettings);
      this.settings = deepmerge(new LinkIndexerSettings(), loadedSettings);
      this.settings.usedLinks = [];
      loadedSettings.usedLinks?.forEach((r: UsedLinks) => {
        this.settings.usedLinks.push(deepmerge(new UsedLinks(), r))
      });
    } else {
      this.log("No saved settings found, using defaults");
    }
    
    this.setupCommands();
    this.addSettingTab(new LinkIndexerSettingTab(this.app, this));
    
    this.log("Plugin loaded successfully");
  }

  async onunload() {
    // No need to clear commands - Obsidian handles this automatically on plugin unload
    this.log("Plugin unloaded");
    await this.saveData(this.settings);
  }

  // Central logging function with safety check
  log(message: string, ...args: any[]) {
    if (this.settings?.enableConsoleLogging !== false) {
      console.log(`Link Indexer (PNX): ${message}`, ...args);
    }
  }

  // Central error logging function with safety check
  logError(message: string, ...args: any[]) {
    if (this.settings?.enableConsoleLogging !== false) {
      console.error(`Link Indexer (PNX): ${message}`, ...args);
    }
  }

  // Central warning logging function with safety check
  logWarn(message: string, ...args: any[]) {
    if (this.settings?.enableConsoleLogging !== false) {
      console.warn(`Link Indexer (PNX): ${message}`, ...args);
    }
  }

  // Brand new function name to avoid any conflicts or references to old code
  setupCommands() {
    this.log("Setting up commands");
    
    // Clear existing command references
    this.registeredCommandIds = [];
    
    this.globalExcludes = [];
    this.settings.usedLinks.forEach((r: UsedLinks) => {
      // Add output paths to global excludes to prevent counting links in the output file itself
      let outputPath = r.path;
      if (!outputPath.endsWith('.md')) {
        outputPath += '.md';
      }
      outputPath = normalizePath(outputPath);
      this.globalExcludes.push(outputPath);
      
      // Register command for this preset
      const commandId = `link-indexer-pnx:used-links:${r.name}`;
      try {
        this.addCommand({
          id: commandId,
          name: `Used links - ${r.name}`,
          callback: async () => {
            this.log(`Executing command for preset ${r.name}`);
            await this.generateAllUsedLinksIndex(getPresetByName(this.settings.usedLinks, r.name));
          }
        });
        
        // Keep track of registered command
        this.registeredCommandIds.push(commandId);
        this.log(`Added command for preset: ${r.name}`);
      } catch (e) {
        this.logError(`Failed to register command for preset ${r.name}:`, e);
      }
    });
  }

  // Helper to clean and normalize wiki-links
  cleanWikiLink(link: string): string {
    // Remove [[ and ]] from wiki-links
    return link.replace(/^\[\[/, '').replace(/\]\]$/, '');
  }

  // Extract display name from a link (without brackets)
  extractDisplayName(link: string): string {
    // Remove [[ and ]] from wiki-links
    let cleanLink = this.cleanWikiLink(link);
    
    // Check if it's an embed with !
    if (cleanLink.startsWith('!')) {
      cleanLink = cleanLink.substring(1);
    }
    
    // Handle aliased links (format: [[actual|display]])
    if (cleanLink.includes('|')) {
      return cleanLink.split('|')[0].trim();
    }
    
    return cleanLink;
  }

  // Extract the alias part from a link if it exists
  extractAlias(link: string): string | null {
    // Remove [[ and ]] from wiki-links
    let cleanLink = this.cleanWikiLink(link);
    
    // Check if it's an embed with !
    if (cleanLink.startsWith('!')) {
      cleanLink = cleanLink.substring(1);
    }
    
    // Handle aliased links (format: [[actual|display]])
    if (cleanLink.includes('|')) {
      const parts = cleanLink.split('|');
      if (parts.length > 1) {
        return parts[1].trim();
      }
    }
    
    return null;
  }

  async generateAllUsedLinksIndex(preset: UsedLinks) {
    this.log("Starting index generation for preset:", preset?.name);
    
    if (!preset) {
      this.logError("Preset not found");
      return new Notice(`Preset not found. Try reloading Obsidian.`);
    }
    
    try {
      const uniqueLinks: Record<string, IndexNode> = {};

      // Ensure proper path with .md extension for exclusion checking
      let outputPath = preset.path;
      if (!outputPath.endsWith('.md')) {
        outputPath += '.md';
      }
      outputPath = normalizePath(outputPath);

      // Get all markdown files
      const files = this.app.vault.getMarkdownFiles();
      this.log(`Processing ${files.length} markdown files`);
      
      // Process each file
      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      
      for (const f of files) {
        try {
          // Skip the output file itself to prevent counting its own links
          if (f.path === outputPath) {
            this.log(`Skipping output file ${f.path} to prevent self-counting`);
            skippedCount++;
            continue;
          }
          
          if (this.isExcluded(f, preset.excludeFromFilenames, preset.excludeFromGlobs)) {
            skippedCount++;
            continue;
          }
          
          const fileCache = this.app.metadataCache.getFileCache(f);
          if (!fileCache) {
            this.logWarn(`No file cache for ${f.path}, skipping`);
            skippedCount++;
            continue;
          }
          
          if (fileCache.links) {
            this.grabLinks(uniqueLinks, f, fileCache.links, preset);
          }
          
          if (preset.includeEmbeds && fileCache.embeds) {
            this.grabLinks(uniqueLinks, f, fileCache.embeds, preset);
          }
          
          processedCount++;
        } catch (error) {
          this.logError(`Error processing file ${f.path}:`, error);
          errorCount++;
        }
      }
      
      this.log(`Processed ${processedCount} files, skipped ${skippedCount}, errors in ${errorCount}`);
      this.log(`Found ${Object.keys(uniqueLinks).length} unique links`);
      
      // Sort links based on user preference
      let sortedLinks;
      if (preset.sortAlphabetically) {
        sortedLinks = Object.entries(uniqueLinks).sort((a, b) => {
          const linkA = a[1].displayName.toLowerCase();
          const linkB = b[1].displayName.toLowerCase();
          return linkA.localeCompare(linkB);
        });
      } else {
        sortedLinks = Object.entries(uniqueLinks).sort((a, b) => b[1].count - a[1].count);
      }

      // Create table header with just 3 columns
      let content = "| Count | Link | Connected Terms |\n";
      content += "|-------|------|----------------|\n";

      // Add table rows
      sortedLinks.forEach(([key, node]) => {
        const mainLink = node.displayName;
        
        // Process connected terms
        const connectedTerms = new Set<string>(); // Use a Set to automatically remove duplicates
        
        // Extract aliases from all original links and add them
        node.originalLinks.forEach(linkText => {
          const alias = this.extractAlias(linkText);
          if (alias && alias !== mainLink) {
            connectedTerms.add(alias);
          }
        });
        
        // Convert the Set to a string, making sure to escape any | characters
        const connectedTermsText = Array.from(connectedTerms).join(", ");
        
        // Add the row to the table
        content += `| ${node.count} | ${node.link} | ${connectedTermsText} |\n`;
      });

      // Ensure proper path with .md extension
      if (!outputPath.endsWith('.md')) {
        outputPath += '.md';
      }
      
      this.log(`Preparing to write to ${outputPath}`);
      
      try {
        // Check if file exists
        const exists = await this.app.vault.adapter.exists(outputPath);
        this.log(`File exists check: ${exists}`);
        
        if (exists) {
          // Update existing file
          await this.app.vault.adapter.write(outputPath, content);
          this.log(`Updated existing file at ${outputPath}`);
          new Notice(`Link Indexer (PNX): Updated index at ${outputPath} with ${Object.keys(uniqueLinks).length} unique links`);
        } else {
          // Create new file - ensure directory exists
          const dirPath = outputPath.substring(0, outputPath.lastIndexOf('/'));
          
          // If path contains directories, ensure they exist
          if (dirPath && dirPath !== outputPath) {
            const dirExists = await this.app.vault.adapter.exists(dirPath);
            if (!dirExists) {
              // Try to create directory if needed
              try {
                await this.app.vault.createFolder(dirPath);
                this.log(`Created directory ${dirPath}`);
              } catch (e) {
                this.logError(`Failed to create directory ${dirPath}:`, e);
                new Notice(`Error: Could not create directory ${dirPath}`);
                throw e;
              }
            }
          }
          
          // Now create the file
          await this.app.vault.create(outputPath, content);
          this.log(`Created new file at ${outputPath}`);
          new Notice(`Link Indexer (PNX): Created new index at ${outputPath} with ${Object.keys(uniqueLinks).length} unique links`);
        }
        
        // Verify file exists after operation
        const finalCheck = await this.app.vault.adapter.exists(outputPath);
        this.log(`Final file exists check: ${finalCheck}`);
        
      } catch (error) {
        this.logError(`Error writing to file ${outputPath}:`, error);
        new Notice(`Error writing to file: ${error.message}`);
        throw error;
      }
    } catch (error) {
      this.logError("Error in generateAllUsedLinksIndex:", error);
      new Notice(`Error generating index: ${error.message}`);
    }
  }

  isExcluded(f: TFile, filenamePatterns: string[], globPatterns:  string[]) {
    const isGloballyExcluded = this.globalExcludes.some((g) => pathEqual(g, f.path));
    const isFilenameExcluded = filenamePatterns.some((p) => new RegExp(p).test(f.name));
    const isGlobExcluded = picomatch.isMatch(f.path, globPatterns);
    return isGloballyExcluded || isFilenameExcluded || isGlobExcluded;
  }

  grabLinks(uniqueLinks: Record<string, IndexNode>, f: TFile, links: ReferenceCache[], preset: UsedLinks) {
    if (!links || !links.length) return;
    
    links.forEach((l) => {
      if (!l || !l.link) return;
      
      const link = getLinkpath(l.link);
      const originFile = this.app.metadataCache.getFirstLinkpathDest(link, f.path);
      if (originFile && (preset.nonexistentOnly || this.isExcluded(originFile, preset.excludeToFilenames, preset.excludeToGlobs))) {
        return;
      }

      const origin = originFile ? originFile.path : link;
      const normalizedOrigin = origin.toLowerCase(); // Normalize for connected terms tracking

      // Track the original link text for connected terms feature
      const originalLinkText = l.original || link;
      const displayName = this.extractDisplayName(originalLinkText);

      if (uniqueLinks[normalizedOrigin]) {
        uniqueLinks[normalizedOrigin].count += 1;
        uniqueLinks[normalizedOrigin].originalLinks.push(originalLinkText);
      } else {
        const rawLink = originFile ? this.app.metadataCache.fileToLinktext(originFile, preset.path, true) : link;
        uniqueLinks[normalizedOrigin] = {
          count: 1,
          link: preset.linkToFiles ? `[[${rawLink}]]` : rawLink,
          originalLinks: [originalLinkText],
          displayName: displayName
        };
      }
    });
  }
}

class UsedLinks {
  name: string;
  path: string;
  strictLineBreaks = true;
  includeEmbeds = true;
  linkToFiles = true;
  nonexistentOnly = false;
  sortAlphabetically = false; // New option for alphabetical sorting
  excludeToFilenames: string[] = [];
  excludeToGlobs: string[] = [];
  excludeFromFilenames: string[] = [];
  excludeFromGlobs: string[] = [];

  constructor() {
    this.name = Date.now().toString();
    this.path = `used_links${this.name}`;  // Default without extension
  }
}

class LinkIndexerSettings {
  usedLinks: UsedLinks[] = [];
  enableConsoleLogging = true; // New setting for console logging
}

type Preset = UsedLinks;

function getPresetByName(presets: Preset[], name: string): Preset {
  return presets.find((r) => r.name === name);
}

class LinkIndexerSettingTab extends PluginSettingTab {
  display(): void {
    let { containerEl } = this;
    const plugin: LinkIndexer = (this as any).plugin;

    containerEl.empty();

    // Global settings section
    containerEl.createEl('h2', {text: 'Global Settings'});
    
    // Console logging toggle
    new Setting(containerEl)
      .setName('Enable console logging')
      .setDesc('Toggle detailed logging to the developer console. Useful for debugging.')
      .addToggle((toggle) => 
        toggle
          .setValue(plugin.settings.enableConsoleLogging)
          .onChange(async (value) => {
            plugin.settings.enableConsoleLogging = value;
            await plugin.saveData(plugin.settings);
          })
      );
      
    containerEl.createEl('h2', {text: 'Used Links Presets'});

    if (plugin.settings.usedLinks.length === 0) {
      containerEl.createEl('p', {
        text: 'No presets defined yet. Click "Add preset" below to create one.'
      });
    }

    plugin.settings.usedLinks.forEach((report) => {
      new Setting(containerEl)
        .setName('Preset name')
        .setDesc('Allowed characters: ASCII letters, digits, underscores, spaces')
        .addText((text) => 
          text.setPlaceholder(report.name)
            .setPlaceholder(report.name)
            .setValue(report.name)
            .onChange(async (value: string) => {
              report.name = value;
              await this.saveData({ refreshUI: false });
            })
        );
      new Setting(containerEl)
        .setName('All used links')
        .setDesc('Path to the note that will contain all found links (add .md extension if desired)')
        .addText((text) => 
          text
            .setPlaceholder(report.path)
            .setValue(report.path)
            .onChange(async (value) => {
              report.path = value;
              await this.saveData({ refreshUI: false });
            })
        );
      
      new Setting(containerEl)
        .setName('Include embeds')
        .setDesc('When disabled, only direct links are counted. Enable to include embedded (trascluded) links.')
        .addToggle((value) => 
          value
            .setValue(report.includeEmbeds)
            .onChange(async (value) => {
              report.includeEmbeds = value;
              await this.saveData({ refreshUI: false });
            })
        );
      
      new Setting(containerEl)
        .setName('Nonexistent files only')
        .setDesc('When disabled, links to both existing and nonexisting files are counted.')
        .addToggle((value) => 
          value
            .setValue(report.nonexistentOnly)
            .onChange(async (value) => {
              report.nonexistentOnly = value;
              await this.saveData({ refreshUI: false });
            })
        );

      // Add the new setting for alphabetical sorting
      new Setting(containerEl)
        .setName('Sort alphabetically')
        .setDesc('When enabled, links will be sorted alphabetically instead of by count.')
        .addToggle((value) => 
          value
            .setValue(report.sortAlphabetically)
            .onChange(async (value) => {
              report.sortAlphabetically = value;
              await this.saveData({ refreshUI: false });
            })
        );

      new Setting(containerEl)
        .setName('Strict line breaks')
        .setDesc('Corresponds to the same Editor setting: "off" = one line break, "on" = two line breaks.')
        .addToggle((value) => 
          value
            .setValue(report.strictLineBreaks)
            .onChange(async (value) => {
              report.strictLineBreaks = value;
              await this.saveData({ refreshUI: false });
            })
        );
      
      new Setting(containerEl)
        .setName('Link to files')
        .setDesc('When "on" the output file will use wiki-links to files. Disable if you don\'t want to pollute graph with it.')
        .addToggle((value) => 
          value
            .setValue(report.linkToFiles)
            .onChange(async (value) => {
              report.linkToFiles = value;
              await this.saveData({ refreshUI: false });
            })
        );
      
      new Setting(containerEl)
        .setName('Exclude links from files')
        .setDesc('Expects regex patterns. Checks for filename without path.')
        .addTextArea((text) => 
          text
            .setValue(report.excludeFromFilenames.join('\n'))
            .onChange(async (value) => {
              report.excludeFromFilenames = value.split('\n').filter((v) => v);
              await this.saveData({ refreshUI: false });
            })
        );
      
      new Setting(containerEl)
        .setName('Exclude links from paths')
        .setDesc('Expects path globs. Checks for file path including filename.')
        .addTextArea((text) => 
          text
            .setValue(report.excludeFromGlobs.join('\n'))
            .onChange(async (value) => {
              report.excludeFromGlobs = value.split('\n').filter((v) => v);
              await this.saveData({ refreshUI: false });
            })
        );
      
      new Setting(containerEl)
        .setName('Exclude links to files')
        .setDesc('Expects regex patterns. Checks for filename without path.')
        .addTextArea((text) => 
          text
            .setValue(report.excludeToFilenames.join('\n'))
            .onChange(async (value) => {
              report.excludeToFilenames = value.split('\n').filter((v) => v);
              await this.saveData({ refreshUI: false });
            })
        );
      
      new Setting(containerEl)
        .setName('Exclude links to paths')
        .setDesc('Expects path globs. Checks for file path including filename.')
        .addTextArea((text) => 
          text
            .setValue(report.excludeToGlobs.join('\n'))
            .onChange(async (value) => {
              report.excludeToGlobs = value.split('\n').filter((v) => v);
              await this.saveData({ refreshUI: false });
            })
        );
      
      const deleteButton = new Setting(containerEl).addButton((extra) => {
        return extra.setButtonText('Delete preset').onClick(async() => {
          const index = plugin.settings.usedLinks.findIndex((r) => r.name === report.name);
          if (index > -1) {
            plugin.settings.usedLinks.splice(index, 1);
            await this.saveData();
          }
        });
      });
      deleteButton.settingEl.style.borderBottom = '1px solid var(--text-accent)';
    });

    const addButton = new Setting(containerEl).addButton((button) => {
      return button.setButtonText('Add preset').onClick(async () => {
        plugin.settings.usedLinks.push(new UsedLinks());
        await this.saveData();
      });
    });

    addButton.infoEl.remove();
    addButton.settingEl.style.justifyContent = 'center';
  }

  async saveData(options = { refreshUI: true }) {
    const plugin: LinkIndexer = (this as any).plugin;
    await plugin.saveData(plugin.settings);
    plugin.setupCommands();
    if (options.refreshUI) this.display();
  }
}

function pathEqual(a: string, b: string) {
  if (a === b) return true

  return removeDots(normalizePath(a)) === removeDots(normalizePath(b))
}

function removeDots(value: string) {
  return value.replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/\.\//, '/')
}