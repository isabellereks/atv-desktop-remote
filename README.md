# ATV Desktop Remote
A simple menubar app that allows you to control an Apple TV from your desktop

 ![What this application looks like when running in either light or dark mode](screenshot_new.png)



## Installation

Build this fork from source using the instructions below. The Homebrew cask and upstream release downloads contain the upstream app.

## Usage

 1. Keys are mapped to the keyboard when the application is open (pressing return or enter on the keyboard for select, delete for Menu, etc).
 2. Press `Option`, or `Alt` on Windows, to see what the characters are mapped to when the application is open.
 3. Hold the TV button to open Control Center.
 4. Swipe over the navigation pad with a trackpad or drag across it with a mouse.
 5. Drag the grip at the top to move the window. The remote remembers its position.
 
 <p align="center">
  <img src="buttonpress.gif" alt="long press button animation" width="200"/>
</p>
 
 
 
## Running

Use Node.js 24. On Mac, this fork requires macOS 13 or later.

```sh
npm ci --legacy-peer-deps
npm ci --prefix app --legacy-peer-deps
npm start
```

Click the remote icon in the macOS menu bar to open the remote, then select the Apple TV on your local network. Enter the four-digit PIN displayed on the TV. Press Cmd+Shift+R on macOS or Win+Shift+R on Windows to reopen the remote.

## Building

Use `npm run build-arm` for an Apple Silicon build. A Developer ID-signed macOS distribution requires a signing identity and notarization credentials.

Pairings use Electron's OS-backed encrypted storage. On first launch after an upgrade, the app imports saved pairings from the previous renderer storage and removes the old entries after the encrypted write succeeds.

## Privacy and local network access

ATV Remote uses multicast DNS for discovery and an encrypted Companion connection to your paired Apple TV. Companion connections are limited to private addresses on a directly attached subnet. The app has no telemetry, account, or automatic updater. Its windows load bundled resources and the keyboard does not use spellcheck or autocomplete.

## Notes

This is cobbled together from a few projects I've worked on. It works well enough for me for daily use, so I figured others might like it. 

This project uses [atv-js](https://github.com/bsharper/atvjs) for Apple TV discovery and control.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/brianharper)
