/**
 * Example Timeline Feed Component
 * Demonstrates using useTimeline hook with Note casts
 */
import { useTimeline } from '@/hooks/useTimeline';
import { use$ } from '@/hooks/use$';
import { defaultRelays } from '@/services/state';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { NoteContent } from '@/components/NoteContent';
import type { Note } from 'applesauce-common/casts';

export function TimelineFeed() {
  const relays = use$(defaultRelays);
  const notes = useTimeline(relays, [{ kinds: [1], limit: 20 }]);

  if (!notes) {
    return <TimelineSkeleton />;
  }

  if (notes.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 px-8 text-center">
          <p className="text-muted-foreground">
            No notes found. Try checking your relay connections.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}

function NoteCard({ note }: { note: Note }) {
  // Reactive author profile subscription
  const profile = use$(note.author.profile$);

  // Reactive reply-to subscription
  const replyingTo = use$(note.replyingTo$);

  return (
    <Card>
      {replyingTo && (
        <div className="border-b p-3 bg-muted/50">
          <p className="text-sm text-muted-foreground">
            Replying to a note...
          </p>
        </div>
      )}

      <CardHeader>
        <div className="flex items-center space-x-3">
          <Avatar>
            <AvatarImage src={profile?.picture} />
            <AvatarFallback>
              {profile?.name?.charAt(0) || '?'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-semibold">{profile?.name || 'Anonymous'}</p>
            <p className="text-sm text-muted-foreground">
              {new Date(note.event.created_at * 1000).toLocaleDateString()}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <NoteContent event={note.event} />
      </CardContent>

      <CardFooter className="flex gap-4 text-sm text-muted-foreground">
        <button className="hover:text-foreground transition-colors">
          Reply
        </button>
        <button className="hover:text-foreground transition-colors">
          Repost
        </button>
        <button className="hover:text-foreground transition-colors">
          React
        </button>
      </CardFooter>
    </Card>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
