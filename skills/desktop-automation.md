---
name: desktop-automation
description: Closed-loop control of the Linux desktop — see the screen, move the mouse, click, type, verify. The recipe for acting like a human user.
trigger: click, open app, browser, firefox, chrome, type into, press, desktop, screen, automate, GUI, window, button, scroll, drag, screenshot
---

# Desktop Automation (eyes + hands closed loop)

You have a **body**: `screen.look` (see), `input.mouse` / `input.type` / `input.key` (act).
The golden rule of desktop automation: **never act blind — look, act, look again.**

## The loop (always follow it)

1. **Orient**: `screen.look` with a targeted prompt, e.g.
   `"Where is the Firefox address bar? Give its approximate x,y coordinates."`
2. **Act**: `input.mouse` `{action:"click", x, y}` or `input.type` / `input.key`.
3. **Verify**: `screen.look` again — `"Did the search results page load?"`
4. **Adjust or retry** (max 3 attempts), then report honestly what you see.

## Recipes

- **Open an app**: `shell.exec` `firefox &` (or `input.key` `ctrl+alt+t` style shortcuts), wait ~1-2s, then `screen.look` to confirm it opened.
- **Type into a field**: click the field (verified), then `input.type` with the text, then `screen.look` to confirm the text appears before pressing enter.
- **Keyboard shortcut**: `input.key` `{keys:"ctrl+shift+t"}`, `alt+F4` (close), `super` (open overview).
- **Scroll to find something**: `input.mouse` `{action:"scroll", direction:"down", amount:5}` then `screen.look` again.
- **Drag a file/window**: `input.mouse` `{action:"drag", from:{x,y}, to:{x,y}}`.
- **Switch windows**: `input.windows` `{action:"list"}` → `{action:"activate", title:"..."}` (X11), or `alt+tab` via `input.key`.
- **Read a dialog/popup**: `screen.look` `"What does this dialog say? What are the button labels and positions?"` — then click the right button by coordinates.
- **Webcam check**: `vision.look` `"Is anyone/specific object visible? Describe briefly."` — always tell the user before you take a webcam photo.

## Rules

- One action at a time; verify each before the next.
- Coordinates from vision are approximate — if a click missed, re-look and re-aim (UI elements move, panels shift).
- Slow down for animations: `shell.exec` `sleep 1` between action and verification when UI transitions.
- If hands/eyes fail: `self.sensors` gives the exact missing piece + one-line fix. Common fixes:
  - X11: `sudo apt install -y xdotool scrot`
  - Wayland: `sudo apt install -y ydotool wtype grim` (+ enable ydotoold, relogin)
  - Camera: `sudo apt install -y ffmpeg`
- Type long text in chunks (≤ ~200 chars per `input.type` call) with small pauses for reliability.
- If the user asks you to stop an automation loop immediately: stop, no retries.
