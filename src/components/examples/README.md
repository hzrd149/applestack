# Example Components

This directory contains example components demonstrating Applesauce features and patterns.

## Available Examples

### `TimelineFeed.tsx`
A complete timeline feed implementation showing:
- `useTimeline` hook with Note casts
- Reactive profile loading with `use$`
- Loading states with Skeleton
- Empty states
- Note rendering with NoteContent

Usage:
```tsx
import { TimelineFeed } from '@/components/examples/TimelineFeed';

function HomePage() {
  return (
    <div className="container mx-auto py-8">
      <h1>Latest Notes</h1>
      <TimelineFeed />
    </div>
  );
}
```

### `ProfileCard.tsx`
A user profile card showing:
- `useProfile` hook with ProfileModel
- Profile metadata display (name, picture, banner, about, nip05, website, lightning address)
- NIP-19 npub encoding
- Loading skeleton state

Usage:
```tsx
import { ProfileCard } from '@/components/examples/ProfileCard';

function UserPage({ pubkey }: { pubkey: string }) {
  return (
    <div className="container mx-auto py-8">
      <ProfileCard pubkey={pubkey} />
    </div>
  );
}
```

## Creating Your Own Examples

When creating new example components:

1. **Use proper hooks** - Leverage `use$`, `useEventStore`, `useProfile`, `useTimeline`, etc.
2. **Handle loading states** - Use Skeleton components that match your structure
3. **Handle empty states** - Show helpful messages when no data is found
4. **Use Cast system** - Cast events to Note/User/Comment for reactive properties
5. **Document patterns** - Add comments explaining the applesauce patterns used

## Best Practices

- **Reactive subscriptions**: Use `use$` for all RxJS observable subscriptions
- **Cast events**: Use `castEvent` or `useTimeline` to get Note casts with reactive properties
- **Models over manual queries**: Use ProfileModel, ThreadModel, etc. instead of manual kind 0 queries
- **Actions for mutations**: Use Actions (UpdateProfile, CreateNote, etc.) instead of manual event creation
- **Loaders for pagination**: Use createTimelineLoader for infinite scroll patterns
