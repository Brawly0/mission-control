# 0026: Refine shared UI behavior

2026-10-27

Keep the existing feature set, brand palette and page structure. Improve shared controls so existing screens behave consistently.

Menus portal by default to escape clipped panels, measure only while open, choose above/below placement from available space, and stay within the viewport. Arrow keys, Home/End, Escape and Tab work with focus restored to the trigger. Disabled items are skipped. Menus dismiss when their surrounding page scrolls; their own scrolling remains usable. Keyboard focus moves after portal positioning makes the menu visible.

LoadingState supplies a consistent compact status indicator for activity, chats, usage, documents and search. Search distinguishes pending, empty and initial states, ignores replies to obsolete requests and uses provider-neutral wording. Document reads ignore obsolete replies and disable Edit while content is unavailable, rather than presenting an old file or error message as editable content.

Helper text and semantic status colors gain contrast without replacing the brand colors. Small buttons and dialogs share more consistent dimensions, compact page padding is aligned, and long titles, tabs and input fields can fit their containers. Reduced-motion preferences suppress decorative animation. The light-theme Restore label inherits its button foreground instead of the banner's text color.

Verification uses a free isolated Electron visual tour with both themes, wide/minimum-width windows, actual menu key presses, bottom-edge placement, search progress and Settings at 125% zoom, plus the normal typecheck/build and unit suite.
