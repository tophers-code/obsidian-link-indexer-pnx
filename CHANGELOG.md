# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2025-05-18
### Added
- Table format for index output with headers for better HTML display
- Connected terms tracking to show variations of the same link
- Option to sort links alphabetically instead of just by frequency
- Toggle for console logging in settings to keep developer console clean
- Central logging system with proper log types (info, warning, error)
- Updated documentation with new features
- Better compatibility with newer Obsidian versions
- Acknowledgment of Claude AI's assistance with the update

### Changed
- Modified the output format from simple list to proper Markdown table
- Updated interface to include option for alphabetical sorting
- Improved tracking of link variations for connected terms feature
- Restructured settings with separate global and preset sections
- Refactored logging system for better error handling and consistency
- Updated package information and repository details
- Fixed issue with duplicate counting by excluding output files from processing

### Fixed
- Resolved table formatting issues with pipe characters in connected terms
- Fixed self-counting bug where the plugin would count links in its own output file
- Improved error handling for settings initialization


## Previous Changes 

All previous changes can be found on the original plugin by @aviskase [obsidian-link-indexer](https://github.com/aviskase/obsidian-link-indexer/) from [1.0.0](https://github.com/aviskase/obsidian-link-indexer/blob/070287bd1140636f345c0aa6bbfabd0ed40a32b1/CHANGELOG.md) (2020-12-05) on back.