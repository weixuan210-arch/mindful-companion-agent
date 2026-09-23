# My Cozy Keeper

I would like to build a companion agent with a cozy persona that does a few things:
- Chat with me, allow me to capture my thoughts, and store them in a secure database (e.g. my own GDrive)
- Be able to retrieve these information to have meaningful conversations with me (e.g. remind me of things)

Help me keep track of tasks that I send to it via the chat

Mood follows behavioural patterns, not completion counts. Things like how old a task is and whether it's overdue drive it, so the companion sees a task you've been avoiding for three days even if you completed five others.

Downward-trend nudges have a persistence threshold. One missed task isn't a pattern, and nudging too early reads as anxious monitoring rather than care. The nudges are passive, meaning they appear when you open the app, with no push notifications.

The reassurance is meant to stay honest. The companion sees the full picture and chooses a caring frame. It doesn't praise blindly, which would make the comfort meaningless.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://mindful-companion-agent.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/02e71184-49e8-4767-bc9c-c7573b90b5f9).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
