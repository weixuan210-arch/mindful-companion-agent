# Animated Billy in chat

## What will change
- Create a reusable animated Billy portrait that preserves the current illustrated owl.
- Add distinct resting, cheerful, curious, thoughtful, and caring expressions.
- Choose Billy’s baseline expression from his behavioural mood, then adapt it to the tone of his latest reply.
- Show the animated portrait beside Billy’s newest reply and while he is thinking, with subtle blinking, breathing, and movement.
- Keep motion calm and respect reduced-motion preferences.

## Technical details
- Generate a cohesive transparent expression set from the existing Billy artwork.
- Add a small client-side tone classifier for streamed assistant text; it will not change chat storage or the AI response flow.
- Crossfade expression artwork with Motion while keeping the existing AI Elements transcript and composer intact.
- Verify the chat at desktop and mobile sizes, then check the current preview build and interaction flow.
