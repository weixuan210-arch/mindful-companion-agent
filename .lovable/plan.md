# Animated Billy sidebar companion

## What I’ll build
- Add a persistent Billy companion to the sidebar, anchored near the lower corner without covering tasks or controls.
- Let Billy idle with subtle breathing, blinking, head movement, and occasional expression changes.
- Make his expression follow the same behavioural mood already used by the app.
- React immediately while chat is thinking and after Billy replies, using the reply’s tone to choose cheerful, curious, thoughtful, caring, or calm.
- Add a compact speech cue so the reaction feels connected to the current conversation without duplicating the full message.
- Keep the companion usable on smaller screens by docking it unobtrusively and allowing it to collapse.

## Technical details
- Extend the existing `AnimatedBilly` portrait rather than creating a second animation system.
- Lift the active chat expression and thinking state to the main page so both chat and sidebar stay synchronized.
- Use Motion transitions and semantic design tokens; respect reduced-motion preferences.
- Preserve the current AI Elements transcript and composer behavior.
- Verify authenticated chat behavior and layouts at desktop and mobile sizes, then confirm the preview build is clean.
