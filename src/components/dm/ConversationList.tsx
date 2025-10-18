import { useDMContext } from '@/contexts/DMContext';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ConversationListProps {
  selectedPubkey: string | null;
  onSelectConversation: (pubkey: string) => void;
  className?: string;
}

function ConversationItem({ 
  pubkey, 
  isSelected, 
  onClick,
  lastMessage,
  lastActivity,
  hasNIP17Messages
}: { 
  pubkey: string; 
  isSelected: boolean; 
  onClick: () => void;
  lastMessage: { decryptedContent?: string; error?: string } | null;
  lastActivity: number;
  hasNIP17Messages: boolean;
}) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;

  const displayName = metadata?.name || genUserName(pubkey);
  const avatarUrl = metadata?.picture;
  const initials = displayName.slice(0, 2).toUpperCase();

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const now = Date.now() / 1000;
    const diff = now - timestamp;

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  const lastMessagePreview = lastMessage?.error 
    ? '🔒 Encrypted message' 
    : lastMessage?.decryptedContent?.slice(0, 50) || 'No messages yet';

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg transition-colors hover:bg-accent",
        isSelected && "bg-accent"
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10 flex-shrink-0">
          <AvatarImage src={avatarUrl} alt={displayName} />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-medium text-sm truncate">{displayName}</span>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {formatTime(lastActivity)}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground truncate flex-1">
              {lastMessagePreview}
            </p>
            {hasNIP17Messages && (
              <Badge variant="secondary" className="text-xs flex-shrink-0">
                NIP-17
              </Badge>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function ConversationListSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-start gap-3 p-3">
          <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationList({ 
  selectedPubkey, 
  onSelectConversation,
  className 
}: ConversationListProps) {
  const { conversations, isLoading } = useDMContext();

  if (isLoading) {
    return (
      <Card className={cn("h-full", className)}>
        <ConversationListSkeleton />
      </Card>
    );
  }

  if (conversations.length === 0) {
    return (
      <Card className={cn("h-full flex items-center justify-center p-8", className)}>
        <div className="text-center text-muted-foreground">
          <p className="text-sm">No conversations yet</p>
          <p className="text-xs mt-1">Start a new conversation to get started</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("h-full flex flex-col", className)}>
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">Messages</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
        </p>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.pubkey}
              pubkey={conversation.pubkey}
              isSelected={selectedPubkey === conversation.pubkey}
              onClick={() => onSelectConversation(conversation.pubkey)}
              lastMessage={conversation.lastMessage}
              lastActivity={conversation.lastActivity}
              hasNIP17Messages={conversation.hasNIP17Messages}
            />
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}

