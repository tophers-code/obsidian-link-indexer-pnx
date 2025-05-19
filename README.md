# obsidian-link-indexer-pnx

This plugin for [Obsidian](https://obsidian.md/) generates index notes with links based on various conditions, now with enhanced table formatting and connected terms tracking.

## Features

- Creates table-based index notes listing all links in your vault
- Tracks how many times each link is used
- Shows connected terms (different versions of the same link)
- Sort alphabetically or by frequency
- Customizable exclusion patterns for specific files or folders
- Support for embedded links

## Usage

Plugin adds commands and settings for each type of index note.

You can have as many settings presets as you want, for example, one used links report for all data and another for non-existing files only.

To configure the plugin, go to plugin settings and add a preset with desired configuration. After that you'll see a new command added to the palette with the name `Link indexer: Used links - {name of the preset}`.

### Used links

Vault had:

- note A with links B and C
- note B with link C
- note C with link to B and non-existing note X

Command will create an index note (check path in settings) with the content:

```markdown
| Count | Link | Connected Terms |
|-------|------|----------------|
| 2 | [[B]] | B, b |
| 2 | [[C]] | C, c |
| 1 | [[X]] | X |
```

#### Output Settings

**Include embeds** counts both `![[file]]` and `[[file]]` links. When disabled, it will count only `[[file]]` links.

**Nonexistent files only**. When enabled, the example above would generate a note with only the X entry.

**Sort alphabetically**. When enabled, links will be sorted alphabetically instead of by frequency count.

**Strict line breaks** corresponds to the same Editor setting: "off" = one line break, "on" = two line breaks.

**Link to files**. When "on" the output file will use wiki-links to files. Disable if you don't want to pollute graph with it.

Off:

```markdown
| Count | Link | Connected Terms |
|-------|------|----------------|
| 2 | B | B, b |
| 2 | C | C, c |
| 1 | X | X |
```

**Exclude links from files** and **Exclude links to files** allow skipping files during indexing. Both accept regex patterns. If you need several excludes, add them on separate lines. Exclusion is checked only for existing files and only for filename without path.

**Exclude links from paths** and **Exclude links to paths** works similarly to filename exclusion, but accept glob patterns. Check [picomatch docs](https://www.npmjs.com/package/picomatch#globbing-features) for detailed information. Useful when you want to exclude some directories, for example, exclude everything from directory *Dailies* is `Dailies/**/*`. 

## Compatibility
This plugin was originally developed against Obsidian v0.9.12, but the updated version should work on recent Obsidian releases.

## Credits
- Originally created by [Yuliya Bagriy](https://github.com/aviskase) in 2020-2021
- Updated by Topher Warrington in 2025 to include table formatting and connected terms tracking
- The plugin update process was streamlined with assistance from Anthropic's Claude AI, which helped analyze the codebase and implement the new features

## License
MIT License