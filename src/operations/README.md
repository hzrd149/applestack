# Custom Operations

This directory contains custom event operations for your application.

Operations are composable functions that modify event templates. They can be chained together to build complex events.

## Example Usage

```typescript
import type { Operation } from 'applesauce-factory';
import { addTag } from 'applesauce-factory/operations/tags';

/**
 * Add mention tags (p-tags) for multiple users
 */
export function addMentions(pubkeys: string[]): Operation {
  return async (ctx, draft) => {
    for (const pubkey of pubkeys) {
      await addTag(['p', pubkey, '', 'mention'])(ctx, draft);
    }
    return draft;
  };
}

/**
 * Add a content warning tag
 */
export function addContentWarning(reason?: string): Operation {
  return async (ctx, draft) => {
    const tag = reason ? ['content-warning', reason] : ['content-warning'];
    await addTag(tag)(ctx, draft);
    return draft;
  };
}
```

## Using Operations

```typescript
import { factory } from '@/services/actions';
import { NoteBlueprint } from 'applesauce-common/blueprints';
import { addMentions, addContentWarning } from '@/operations/custom';

const event = await factory.create(
  NoteBlueprint('Hello @alice and @bob!'),
  addMentions([alicePubkey, bobPubkey]),
  addContentWarning('NSFW')
);
```

## Available Built-in Operations

Applesauce provides built-in operations in `applesauce-factory/operations`:

- `setContent(text)` - Set event content
- `addTag(tag)` - Add a tag
- `addTags(tags)` - Add multiple tags
- `removeTag(name)` - Remove tags by name
- `setCreatedAt(timestamp)` - Set created_at
- And more...

Check the applesauce documentation for the full list.
