/**
 * Example Profile Card Component  
 * Demonstrates using User cast system with reactive properties
 */
import { useUser } from '@/hooks/useUser';
import { use$ } from '@/hooks/use$';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { nip19 } from 'nostr-tools';

interface ProfileCardProps {
  pubkey: string;
}

export function ProfileCard({ pubkey }: ProfileCardProps) {
  const user = useUser(pubkey);
  const profile = use$(user?.profile$);
  const follows = use$(user?.contacts$);
  const npub = nip19.npubEncode(pubkey);

  if (!profile) {
    return <ProfileCardSkeleton />;
  }

  return (
    <Card>
      {profile?.banner && (
        <div className="h-32 overflow-hidden">
          <img 
            src={profile.banner} 
            alt="Banner" 
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <CardHeader>
        <div className="flex items-start gap-4">
          <Avatar className="h-20 w-20 border-4 border-background -mt-10">
            <AvatarImage src={profile?.picture} />
            <AvatarFallback className="text-2xl">
              {profile?.name?.charAt(0) || profile?.displayName?.charAt(0) || '?'}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 mt-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">
                {profile?.displayName || profile?.name || 'Anonymous'}
              </h2>
            </div>
            
            {profile?.nip05Verified && (
              <p className="text-sm text-muted-foreground">
                ✓ {profile.nip05Verified}
              </p>
            )}

            <p className="text-xs text-muted-foreground font-mono mt-1">
              {npub.slice(0, 16)}...{npub.slice(-8)}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {profile?.about && (
          <p className="text-sm">{profile.about}</p>
        )}

        {follows && follows.length > 0 && (
          <div className="text-sm text-muted-foreground">
            Following {follows.length} {follows.length === 1 ? 'person' : 'people'}
          </div>
        )}

        {profile?.website && (
          <a 
            href={profile.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-500 hover:underline inline-flex items-center gap-1"
          >
            🔗 {profile.website}
          </a>
        )}

        {(profile?.lud16 || profile?.lud06) && (
          <div className="flex items-center gap-2 text-sm">
            <span>⚡</span>
            <code className="text-xs bg-muted px-2 py-1 rounded">
              {profile.lud16 || profile.lud06}
            </code>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileCardSkeleton() {
  return (
    <Card>
      <Skeleton className="h-32 w-full" />
      
      <CardHeader>
        <div className="flex items-start gap-4">
          <Skeleton className="h-20 w-20 rounded-full -mt-10" />
          <div className="flex-1 mt-2 space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </CardContent>
    </Card>
  );
}
