# ATV Desktop Remote

I just wanted a little Apple TV remote on my Mac. I forked Brian Harper’s app and made the version I wanted to use myself. I figured I’d share it in case anyone else wanted the same thing.

<img src="docs/remote.png" alt="The graphite ATV Desktop Remote with a circular clickpad and volume rocker" width="218">

## What I changed

- The remote has a circular clickpad, a volume rocker, and a tiny remote icon in the menu bar.
- You can swipe over the clickpad with a trackpad, click it with a mouse, or use your keyboard.
- Drag the grip at the top to move the remote. It remembers where you left it.
- There’s a keyboard button for typing into your Apple TV from your Mac.

## Try it on your Mac

I built and tested this on an Apple Silicon Mac running Sequoia. You’ll need macOS 13 or newer, Node.js 24, and an Apple TV on the same local network as your Mac.

This fork is available as source. Here’s how to run it.

```sh
git clone https://github.com/isabellereks/atv-desktop-remote.git
cd atv-desktop-remote
npm ci --legacy-peer-deps
npm ci --prefix app --legacy-peer-deps
npm start
```

Click the little remote icon in your menu bar, select your Apple TV, and enter the four-digit PIN on the TV screen. If macOS asks for Local Network access, allow it so the app can find your Apple TV.

Use the arrow keys and Return to navigate, or hold Option to see shortcuts on the buttons. You can open the remote with **⌃⌘R** and change that shortcut by right-clicking the menu-bar icon.

## I wanted it to stay local

Discovery and remote commands stay on your local network. Pairing credentials are encrypted on your Mac with a key from Keychain. The app uses bundled files for its windows and has no account, analytics, or automatic updater.

## Credits

I forked Brian Harper’s ATV Desktop Remote. The project uses his atv-js library for Apple TV discovery and control. I also took some design cues from Itsytv. [Original project](https://github.com/bsharper/atv-desktop-remote) · [atv-js](https://github.com/bsharper/atvjs) · [Itsytv](https://itsytv.app/en)

The original [MIT license](LICENSE) is included in this repo.
