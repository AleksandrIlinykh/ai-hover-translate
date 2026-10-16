# Closed beta

Two weeks with 20 to 40 people who read and write at work in a second language, before the public launch. The goal: honest reviews ready for day one, and the reasons people would drop SpotSlate, fixed.

## Handing it out

1. **Right away, as a zip.** Run `npm run pack` and send `dist/spotslate-<version>.zip` (or attach it to a GitHub release). Testers unzip it and load the folder as an unpacked extension (see below). Chrome shows its "developer mode" warning, and there are no automatic updates: send a new zip when something is fixed.
2. **Through the Chrome Web Store, once the first version is approved.** Set the item's visibility to "Private" and add the testers' Google accounts as trusted testers (Developer Dashboard, Account, Trusted testers), or to "Unlisted" and send the link. Updates then reach everyone by themselves. The first review takes days to a few weeks, so submit early.

## For the testers

> Thanks for trying SpotSlate. It translates the paragraph you are stuck on, right where you are reading.
>
> **Install** (until it is in the Chrome Web Store): unzip the file, open `chrome://extensions`, turn on "Developer mode" at the top right, click "Load unpacked" and pick the unzipped folder. A welcome page opens: check the language to translate into and try the gestures there. Reload the tabs that were already open.
>
> **Try it where you work:** tickets, wikis, pull requests, chats.
> - Hold Alt over a paragraph: its translation appears above it.
> - Select a word first: a short dictionary entry.
> - Alt+click a text field, or Alt+T while typing: write in your language, copy the text in the page's language; "Check" translates it back.
> - Out of the box it uses Chrome's built-in translator, free and on your computer. For better translations, pick an AI provider in the settings (right-click the icon, "Options") with your own key; DeepSeek is cheap, and Ollama runs on your computer.
>
> **Tell us:** "Report" on a bad translation opens a GitHub issue (paste the text only if it is not confidential), or just answer the questions below. Five minutes is plenty.

## Questions after a week

1. Where did you use it, and how often?
2. What was the moment it helped most? Where did it get in the way?
3. Which translator did you use, and how good were the translations?
4. Did you use writing (Alt+T)? What for?
5. What would make you recommend it, and what would make you remove it?

Also ask for a review on the store page once it is public: only the ones who want to, and never for anything in return (the Chrome Web Store forbids incentives).

## Before sending it out

- Try every preset provider you can with a real key, and Chrome's built-in translator on a fresh profile (the model download).
- Try it on the sites the testers live in: Jira, Confluence, GitHub, Slack web, Google Docs (where the text is drawn on a canvas and cannot be read).
- On Windows and on a Mac (Option instead of Alt; Ctrl+click opens the context menu there).
- After an update, open tabs say "The extension was updated. Reload the page." when Alt is held: tell the testers.
