# Using RxJS Observables in React Components

This guide explains how to use the `use$` hook from `applesauce-react` to integrate RxJS observables into React components.

## Overview

The `use$` hook is a utility that combines React's `useMemo` and a custom observable subscription hook to seamlessly integrate RxJS observables into React components. It automatically handles subscription lifecycle, synchronous initial values, and re-subscriptions when dependencies change.

## Import

```typescript
import { use$ } from '@/hooks/use$';
```

## Core Concepts

### What is `use$`?

`use$` subscribes to an RxJS observable and returns its current value. It:

1. **Automatically subscribes** when the component mounts
2. **Automatically unsubscribes** when the component unmounts
3. **Re-subscribes** when dependencies change
4. **Returns synchronous values immediately** (no extra render for BehaviorSubjects)
5. **Returns `undefined`** while waiting for async observables to emit

### Type Signatures

```typescript
// Direct BehaviorSubject - always returns a value
use$<T>(observable?: BehaviorSubject<T>): T

// Direct Observable - may return undefined if no value emitted yet
use$<T>(observable?: Observable<T>): T | undefined

// Factory function with dependencies - most common pattern
use$<T>(factory: () => Observable<T> | undefined, deps: any[]): T | undefined
```

## Usage Patterns

### Pattern 1: Direct Observable (Simple)

Use this when you have a simple observable that doesn't need to be recreated.

```tsx
import { use$ } from '@/hooks/use$';
import { BehaviorSubject } from 'rxjs';

// Global observable
const theme$ = new BehaviorSubject<'light' | 'dark'>('light');

function ThemeDisplay() {
  // Subscribe to the global observable
  const theme = use$(theme$);
  
  return <div>Current theme: {theme}</div>;
}
```

**When to use:**
- Subscribing to global observables
- Observable doesn't depend on props/state
- No need to recreate the observable

### Pattern 2: Factory Function with Dependencies (Recommended)

Use this when the observable needs to be recreated based on props, state, or other values.

```tsx
import { use$ } from '@/hooks/use$';
import { useEventStore } from '@/hooks/useEventStore';
import { ProfileModel } from 'applesauce-core/models';

function UserProfile({ pubkey }: { pubkey: string }) {
  const store = useEventStore();
  
  // Factory function - recreates observable when pubkey or store changes
  const profile = use$(
    () => store.model(ProfileModel, pubkey),
    [pubkey, store]
  );
  
  if (!profile) return <div>Loading...</div>;
  
  return (
    <div>
      <img src={profile.picture} alt={profile.name} />
      <h2>{profile.name}</h2>
      <p>{profile.about}</p>
    </div>
  );
}
```

**When to use:**
- Observable depends on props, state, or context
- Need to recreate observable when dependencies change
- Working with Applesauce models, timelines, or casts
- **This is the most common pattern in Applesauce apps**

### Pattern 3: Nested Observables from Casts

Applesauce casts expose properties as observables. Use `use$` to subscribe to them.

```tsx
import { use$ } from '@/hooks/use$';
import { Note } from 'applesauce-common/casts';

function NoteCard({ note }: { note: Note }) {
  // Subscribe to nested observables from the cast
  const author = use$(note.author.profile$);
  const reactions = use$(note.reactions$);
  const replies = use$(note.replies$);
  const replyCount = use$(note.replies?.count$);
  
  return (
    <div>
      <div className="author">
        {author?.name ?? 'Anonymous'}
      </div>
      <p>{note.content}</p>
      <div className="stats">
        <span>{reactions?.length ?? 0} reactions</span>
        <span>{replyCount ?? 0} replies</span>
      </div>
    </div>
  );
}
```

**When to use:**
- Working with Applesauce cast properties (User, Note, Reaction, Zap, etc.)
- Accessing reactive properties like `profile$`, `contacts$`, `reactions$`, etc.

### Pattern 4: Chained Observables

Subscribe to observables that depend on other observable values.

```tsx
import { use$ } from '@/hooks/use$';
import { useEventStore } from '@/hooks/useEventStore';

function UserContacts({ pubkey }: { pubkey: string }) {
  const store = useEventStore();
  
  // First, get the user's contacts
  const contacts = use$(
    () => {
      const user = store.castUser(pubkey);
      return user ? user.contacts$ : undefined;
    },
    [pubkey, store]
  );
  
  // Then, get outboxes for each contact using combineLatest
  const contactsWithOutboxes = use$(
    () => {
      if (!contacts) return undefined;
      
      return combineLatest(
        contacts.map(contact => 
          contact.outboxes$.pipe(
            map(outboxes => ({ contact, outboxes }))
          )
        )
      );
    },
    [contacts?.map(c => c.pubkey).join(',')]
  );
  
  return (
    <div>
      {contactsWithOutboxes?.map(({ contact, outboxes }) => (
        <div key={contact.pubkey}>
          {contact.name} - {outboxes.length} relays
        </div>
      ))}
    </div>
  );
}
```

**When to use:**
- Need to combine multiple observables
- Observable depends on the value of another observable
- Using RxJS operators like `combineLatest`, `switchMap`, `map`, etc.

### Pattern 5: Side Effects (Subscriptions)

Use `use$` for subscriptions that don't return a value (side effects only).

```tsx
import { use$ } from '@/hooks/use$';
import { pool } from '@/services/pool';
import { eventStore } from '@/services/stores';

function WalletSync({ relays, pubkey }: { relays: string[]; pubkey: string }) {
  // Subscribe to events - don't need the return value
  use$(
    () => {
      if (relays.length === 0) return undefined;
      
      return pool.subscription(
        relays,
        [
          { kinds: [WALLET_KIND, WALLET_TOKEN_KIND], authors: [pubkey] },
          { kinds: [kinds.EventDeletion], '#k': [String(WALLET_TOKEN_KIND)] }
        ],
        { eventStore }
      );
    },
    [relays.join(','), pubkey]
  );
  
  return <div>Wallet synced</div>;
}
```

**When to use:**
- Setting up relay subscriptions
- Running loaders that update the store
- Side effects that don't produce a value to render

### Pattern 6: Conditional Observables

Handle cases where observables might be undefined.

```tsx
import { use$ } from '@/hooks/use$';
import { of, EMPTY } from 'rxjs';

function ConditionalData({ filters }: { filters?: Filter[] }) {
  const store = useEventStore();
  
  // Return EMPTY or of(undefined) when there's no observable
  const events = use$(
    () => filters ? store.timeline(filters) : EMPTY,
    [filters]
  );
  
  // Or using ternary operator in factory
  const profile = use$(
    () => pubkey ? store.model(ProfileModel, pubkey) : undefined,
    [pubkey]
  );
  
  return <div>{events?.length ?? 0} events</div>;
}
```

**When to use:**
- Observable might not exist based on conditions
- Avoiding unnecessary subscriptions
- Handling optional data

## Dependency Arrays

The dependency array is critical for proper behavior:

```tsx
// ✅ Correct: Include all variables used in factory
const profile = use$(
  () => store.model(ProfileModel, pubkey),
  [pubkey, store]
);

// ✅ Correct: Use stable references for arrays
const events = use$(
  () => pool.req(relays, filters),
  [relays.join(','), JSON.stringify(filters)]
);

// ❌ Wrong: Missing dependencies
const profile = use$(
  () => store.model(ProfileModel, pubkey),
  [] // pubkey and store are missing!
);

// ❌ Wrong: Array reference changes every render
const events = use$(
  () => pool.req(relays, filters),
  [relays] // This creates infinite re-subscriptions!
);
```

### Dependency Array Best Practices

1. **Include all used variables**: Any variable from props, state, or context used in the factory
2. **Serialize arrays/objects**: Use `.join()` or `JSON.stringify()` for array/object dependencies
3. **Use optional chaining**: `contacts?.map(c => c.pubkey).join(',')` handles undefined safely
4. **Avoid inline objects**: Create them outside or use stable references

## Loading States

`use$` returns `undefined` while waiting for the first value from an observable.

```tsx
function UserProfile({ pubkey }: { pubkey: string }) {
  const profile = use$(() => store.model(ProfileModel, pubkey), [pubkey]);
  
  // Handle loading state
  if (!profile) {
    return <Skeleton />;
  }
  
  return <div>{profile.name}</div>;
}
```

**Exception:** BehaviorSubjects always have a value, so they never return `undefined`:

```tsx
const theme$ = new BehaviorSubject('light');
const theme = use$(theme$); // never undefined
```

## Common Patterns with Applesauce

### User Profiles

```tsx
function UserCard({ pubkey }: { pubkey: string }) {
  const store = useEventStore();
  
  const user = useMemo(() => store.castUser(pubkey), [pubkey, store]);
  const profile = use$(user.profile$);
  const contacts = use$(user.contacts$);
  const followers = use$(user.followers$);
  
  return (
    <div>
      <img src={profile?.picture} />
      <h3>{profile?.name}</h3>
      <p>Following: {contacts?.length ?? 0}</p>
      <p>Followers: {followers?.length ?? 0}</p>
    </div>
  );
}
```

### Event Timelines

```tsx
function Feed({ filters }: { filters: Filter[] }) {
  const store = useEventStore();
  
  const events = use$(
    () => store.timeline(filters),
    [JSON.stringify(filters)]
  );
  
  return (
    <div>
      {events?.map(event => (
        <NoteCard key={event.id} note={event} />
      ))}
    </div>
  );
}
```

### Reactions and Zaps

```tsx
function NoteInteractions({ note }: { note: Note }) {
  const reactions = use$(note.reactions$);
  const zaps = use$(note.zaps$);
  
  const totalZapped = zaps?.reduce((sum, zap) => sum + zap.amount, 0) ?? 0;
  
  return (
    <div>
      <span>{reactions?.length ?? 0} reactions</span>
      <span>{totalZapped} sats zapped</span>
    </div>
  );
}
```

### Comments/Replies

```tsx
function CommentSection({ eventId }: { eventId: string }) {
  const store = useEventStore();
  
  const comments = use$(
    () => store.model(CommentsModel, eventId),
    [eventId, store]
  );
  
  return (
    <div>
      <h4>{comments?.count ?? 0} comments</h4>
      {comments?.comments.map(comment => (
        <div key={comment.id}>{comment.content}</div>
      ))}
    </div>
  );
}
```

### Relay Subscriptions

```tsx
function EventLoader({ relays, filters }: { relays: string[]; filters: Filter[] }) {
  const store = useEventStore();
  
  // Set up subscription - updates store as events arrive
  use$(
    () => {
      if (relays.length === 0) return undefined;
      
      return pool.subscription(
        relays,
        filters,
        { eventStore: store }
      ).pipe(
        onlyEvents(),
        mapEventsToStore(store)
      );
    },
    [relays.join(','), JSON.stringify(filters)]
  );
  
  return null; // This component just manages the subscription
}
```

## Performance Considerations

### Avoid Unnecessary Re-subscriptions

```tsx
// ❌ Bad: Creates new array every render
function BadExample({ items }: { items: string[] }) {
  const data = use$(
    () => fetchData(items),
    [items] // Array reference changes every render!
  );
}

// ✅ Good: Stable dependency
function GoodExample({ items }: { items: string[] }) {
  const data = use$(
    () => fetchData(items),
    [items.join(',')] // String is stable if items are same
  );
}
```

### Memoize Complex Dependencies

```tsx
function ComplexDeps({ config }: { config: ComplexConfig }) {
  // Memoize complex objects used in dependencies
  const stableKey = useMemo(
    () => JSON.stringify(config),
    [config.prop1, config.prop2]
  );
  
  const data = use$(
    () => fetchData(config),
    [stableKey]
  );
}
```

### Don't Call use$ Conditionally

```tsx
// ❌ Wrong: Hooks must be called unconditionally
function BadExample({ enabled }: { enabled: boolean }) {
  if (enabled) {
    const data = use$(observable$); // Breaks rules of hooks!
  }
}

// ✅ Correct: Always call hook, conditionally create observable
function GoodExample({ enabled }: { enabled: boolean }) {
  const data = use$(
    () => enabled ? observable$ : EMPTY,
    [enabled]
  );
}
```

## Error Handling

Errors from observables are thrown and can be caught by React Error Boundaries:

```tsx
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = useState(false);
  
  if (hasError) {
    return <div>Something went wrong</div>;
  }
  
  return (
    <React.ErrorBoundary onError={() => setHasError(true)}>
      {children}
    </React.ErrorBoundary>
  );
}

function ComponentWithObservable() {
  // If observable$ emits an error, it will be thrown here
  const data = use$(observable$);
  return <div>{data}</div>;
}
```

## Comparison with Other Hooks

### vs `useEffect` + `useState`

```tsx
// ❌ Manual subscription management
function ManualWay() {
  const [value, setValue] = useState();
  
  useEffect(() => {
    const sub = observable$.subscribe(setValue);
    return () => sub.unsubscribe();
  }, []);
  
  return <div>{value}</div>;
}

// ✅ Automatic with use$
function AutomaticWay() {
  const value = use$(observable$);
  return <div>{value}</div>;
}
```

### vs `useObservableState` (from observable-hooks)

`use$` is built on top of a custom `useObservableState` that:
- Gets synchronous initial values without extra renders
- Works better with BehaviorSubjects
- Integrates with `useMemo` for factory functions

```tsx
// With observable-hooks (2 renders for BehaviorSubject)
const value = useObservableState(behaviorSubject$);

// With use$ (1 render - synchronous initial value)
const value = use$(behaviorSubject$);
```

## Common Mistakes

### 1. Forgetting Dependencies

```tsx
// ❌ Wrong
const profile = use$(() => store.model(ProfileModel, pubkey), []);
// Observable never updates when pubkey changes!

// ✅ Correct
const profile = use$(() => store.model(ProfileModel, pubkey), [pubkey, store]);
```

### 2. Unstable Dependencies

```tsx
// ❌ Wrong
const events = use$(
  () => store.timeline(filters),
  [filters] // Array/object reference
);

// ✅ Correct
const events = use$(
  () => store.timeline(filters),
  [JSON.stringify(filters)]
);
```

### 3. Conditional Hook Calls

```tsx
// ❌ Wrong
if (condition) {
  const data = use$(observable$);
}

// ✅ Correct
const data = use$(
  () => condition ? observable$ : undefined,
  [condition]
);
```

### 4. Not Handling Undefined

```tsx
// ❌ Wrong - will error if profile is undefined
function UserName({ pubkey }: { pubkey: string }) {
  const profile = use$(() => store.model(ProfileModel, pubkey), [pubkey]);
  return <div>{profile.name}</div>; // Error if undefined!
}

// ✅ Correct
function UserName({ pubkey }: { pubkey: string }) {
  const profile = use$(() => store.model(ProfileModel, pubkey), [pubkey]);
  return <div>{profile?.name ?? 'Loading...'}</div>;
}
```

## Advanced: Creating Custom Hooks

Wrap `use$` in custom hooks for reusable patterns:

```tsx
// Custom hook for user profiles
function useProfile(pubkey: string) {
  const store = useEventStore();
  return use$(
    () => store.model(ProfileModel, pubkey),
    [pubkey, store]
  );
}

// Custom hook for timelines
function useTimeline(filters: Filter[]) {
  const store = useEventStore();
  return use$(
    () => store.timeline(filters),
    [JSON.stringify(filters), store]
  );
}

// Usage
function MyComponent({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const notes = useTimeline([{ kinds: [1], authors: [pubkey] }]);
  
  return <div>...</div>;
}
```

## Summary

The `use$` hook is the primary way to integrate RxJS observables into React components when using Applesauce:

1. **Always use factory function pattern** when observable depends on props/state
2. **Include all dependencies** in the dependency array
3. **Serialize arrays/objects** used as dependencies
4. **Handle `undefined`** for initial loading state
5. **Use for side effects** like relay subscriptions and loaders
6. **Follow React hook rules** (no conditional calls)

This pattern enables reactive, real-time updates throughout your Nostr application while maintaining clean React code.
