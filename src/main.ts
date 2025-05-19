import deepmerge from 'deepmerge';
import picomatch from 'picomatch';
import { Plugin, PluginSettingTab, Setting, Vault, normalizePath, TFile, getLinkpath, ReferenceCache, Notice } from 'obsidian';

interface IndexNode {
  count: number;
  link: string;
  originalLinks: string[]; // Store original link variations
}

export default class LinkIndexer extends Plugin {
  settings: LinkIndexerSettings;
  vault: Vault;
  globalExcludes: string[]

  onInit() {}

  async onload() {
    console.log("Link Indexer PNX: Plugin loading...");
    
    const loadedSettings = await this.loadData();
    if (loadedSettings) {
      console.log("Link Indexer PNX: Loaded settings:", loadedSettings);
      this.settings = deepmerge(new LinkIndexerSettings(), loadedSettings);
      this.settings.usedLinks = [];
      loadedSettings.usedLinks?.forEach((r: UsedLinks) => {
        this.settings.usedLinks.push(deepmerge(new UsedLinks(), r))
      });
    } else {
      console.log("Link Indexer PNX: No saved settings found, using defaults");
      this.settings = new LinkIndexerSettings();
    }
    
    this.reloadSettings();
    this.addSettingTab(new LinkIndexerSettingTab(this.app, this));
    
    console.log("Link Indexer PNX: Plugin loaded successfully");
  }

  async onunload() {
    console.log("Link Indexer PNX: Plugin unloaded");
    await this.saveData(this.settings);
  }

  reloadSettings() {
    console.log("Link Indexer PNX: Reloading settings and commands");
    this.removeOwnCommands();
    this.globalExcludes = [];
    this.settings.usedLinks.forEach((r: UsedLinks) => {
      this.globalExcludes.push(r.path);
      this.addCommand({
        id: `link-indexer:used-links:${r.name}`,
        name: `Used links - ${r.name}`,
        callback: async () => await this.generateAllUsedLinksIndex(getPresetByName(this.settings.usedLinks, r.name)),
      });
    });
    console.log("Link Indexer PNX: Added commands for presets:", this.settings.usedLinks.map(r => r.name));
  }

  removeOwnCommands() {
    // @ts-ignore
    this.app.commands.listCommands().map((c) => c.id).filter((c) => c.startsWith(this.manifest.id)).forEach((c: string) => {
      // @ts-ignore
      this.app.commands.removeCommand(c);
    });
  }

  async generateAllUsedLinksIndex(preset: UsedLinks) {
    console.log("Link Indexer PNX: Starting index generation for preset:", preset?.name);
    
    if (!preset) {
      console.error("Link Indexer PNX: Preset not found");
      return new Notice(`Preset not found. Try reloading Obsidian.`);
    }
    
    try {
      const uniqueLinks: Record<string, IndexNode> = {};

      // Get all markdown files
      const files = this.app.vault.getMarkdownFiles();
      console.log(`Link Indexer PNX: Processing ${files.length} markdown files`);
      
      // Process each file
      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      
      for (const f of files) {
        try {
          if (this.isExcluded(f, preset.excludeFromFilenames, preset.excludeFromGlobs)) {
            skippedCount++;
            continue;
          }
          
          const fileCache = this.app.metadataCache.getFileCache(f);
          if (!fileCache) {
            console.warn(`Link Indexer PNX: No file cache for ${f.path}, skipping`);
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
          console.error(`Link Indexer PNX: Error processing file ${f.path}:`, error);
          errorCount++;
        }
      }
      
      console.log(`Link Indexer PNX: Processed ${processedCount} files, skipped ${skippedCount}, errors in ${errorCount}`);
      console.log(`Link Indexer PNX: Found ${Object.keys(uniqueLinks).length} unique links`);
      
      // Sort links based on user preference
      let sortedLinks;
      if (preset.sortAlphabetically) {
        sortedLinks = Object.entries(uniqueLinks).sort((a, b) => {
          // Remove brackets for alphabetical sorting
          const linkA = a[1].link.replace(/[\[\]]/g, '').toLowerCase();
          const linkB = b[1].link.replace(/[\[\]]/g, '').toLowerCase();
          return linkA.localeCompare(linkB);
        });
      } else {
        sortedLinks = Object.entries(uniqueLinks).sort((a, b) => b[1].count - a[1].count);
      }

      // Create table header
      let content = "| Count | Link | Connected Terms |\n";
      content += "|-------|------|----------------|\n";

      // Add table rows
      sortedLinks.forEach(([key, node]) => {
        const connectedTerms = node.originalLinks
          .filter((term, index, self) => self.indexOf(term) === index) // Remove duplicates
          .join(", ");
        content += `| ${node.count} | ${node.link} | ${connectedTerms} |\n`;
      });

      // Write to output file
      const outputPath = normalizePath(preset.path);
      console.log(`Link Indexer PNX: Writing results to ${outputPath}`);
      
      const exist = await this.app.vault.adapter.exists(outputPath, false);
      if (exist) {
        const p = this.app.vault.getAbstractFileByPath(outputPath);
        await this.app.vault.adapter.write(outputPath, content);
        console.log(`Link Indexer PNX: Updated existing file at ${outputPath}`);
      } else {
        await this.app.vault.create(outputPath, content);
        console.log(`Link Indexer PNX: Created new file at ${outputPath}`);
      }
      
      new Notice(`Link Indexer PNX: Successfully generated index with ${Object.keys(uniqueLinks).length} unique links`);
    } catch (error) {
      console.error("Link Indexer PNX: Error in generateAllUsedLinksIndex:", error);
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

      if (uniqueLinks[normalizedOrigin]) {
        uniqueLinks[normalizedOrigin].count += 1;
        uniqueLinks[normalizedOrigin].originalLinks.push(originalLinkText);
      } else {
        const rawLink = originFile ? this.app.metadataCache.fileToLinktext(originFile, preset.path, true) : link;
        uniqueLinks[normalizedOrigin] = {
          count: 1,
          link: preset.linkToFiles ? `[[${rawLink}]]` : rawLink,
          originalLinks: [originalLinkText]
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
    this.path = `./used_links${this.name}.md`;
  }
}

class LinkIndexerSettings {
  usedLinks: UsedLinks[] = [];
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

    containerEl.createEl('h2', {text: 'Used links'});

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
        .setDesc('Path to the note that will contain all found links sorted by their occurrences')
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
    plugin.reloadSettings();
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