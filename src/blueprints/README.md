# Custom Blueprints

This directory contains custom event blueprints for your application.

Blueprints are templates for creating properly formatted Nostr events. They use the applesauce-factory blueprint system to ensure events meet NIP specifications.

## Example Usage

```typescript
import { blueprint, EventBlueprint } from 'applesauce-factory';
import { setContent } from 'applesauce-factory/operations/content';
import { addTag } from 'applesauce-factory/operations/tags';

export function MyCustomBlueprint(
  title: string,
  content: string
): EventBlueprint {
  return blueprint(
    30023, // Event kind
    addTag(['d', title.toLowerCase().replace(/\s+/g, '-')]),
    addTag(['title', title]),
    setContent(content),
  );
}
```

## Creating Events with Blueprints

```typescript
import { factory } from '@/services/actions';
import { MyCustomBlueprint } from '@/blueprints/custom';

const event = await factory.create(
  MyCustomBlueprint('My Title', 'My content')
);
```

## Available Built-in Blueprints

Applesauce provides many built-in blueprints in `applesauce-common/blueprints`:

- `NoteBlueprint` - Kind 1 text notes
- `ReactionBlueprint` - Kind 7 reactions
- `CommentBlueprint` - Kind 1111 comments
- `ArticleBlueprint` - Kind 30023 long-form content
- `RepostBlueprint` - Kind 6/16 reposts
- And many more...

Check the applesauce documentation for the full list.
