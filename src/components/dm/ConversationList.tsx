import { useMemo } from 'react';
import { useDMContext } from '@/contexts/DMContext';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

interface ConversationListProps {
  selectedPubkey: string | null;
  onSelectConversation: (pubkey: string) => void;
  className?: string;
}

const ConversationItem = ({ 
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
}) => {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;

  const displayName = metadata?.name || genUserName(pubkey);
  const avatarUrl = metadata?.picture;
  const initials = displayName.slice(0, 2).toUpperCase();

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const now = Date.now() / 1000;
    const diff = now - timestamp;

    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    
    const date = new Date(timestamp * 1000);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  };

  const lastMessagePreview = lastMessage?.error 
    ? '🔒 Encrypted message' 
    : lastMessage?.decryptedContent?.slice(0, 30) || 'No messages yet';

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg transition-colors hover:bg-accent overflow-hidden",
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
            <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
              {formatTime(lastActivity)}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground truncate flex-1">
              {lastMessagePreview}
            </span>
            {hasNIP17Messages && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">
                17
              </Badge>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

const ConversationListSkeleton = () => {
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
};

export const ConversationList = ({ 
  selectedPubkey, 
  onSelectConversation,
  className 
}: ConversationListProps) => {
  const { conversations, isLoading } = useDMContext();

  // Filter conversations by type
  const { knownConversations, requestConversations } = useMemo(() => {
    return {
      knownConversations: conversations.filter(c => c.isKnown),
      requestConversations: conversations.filter(c => c.isRequest),
    };
  }, [conversations]);

  const renderConversationList = (conversationList: typeof conversations) => {
    if (conversationList.length === 0) {
      return (
        <div className="flex items-center justify-center h-32 text-center text-muted-foreground px-4">
          <p className="text-sm">No conversations</p>
        </div>
      );
    }

    return (
      <ScrollArea className="flex-1 h-full">
        <div className="px-2 py-2 space-y-1 w-full">
          {conversationList.map((conversation) => (
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
    );
  };

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
    <Card className={cn("h-full flex flex-col overflow-hidden", className)}>
      <div className="p-4 border-b flex-shrink-0">
        <h2 className="font-semibold text-lg">Messages</h2>
      </div>
      
      <Tabs defaultValue="known" className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-2 flex-shrink-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="known" className="text-xs">
              Active {knownConversations.length > 0 && `(${knownConversations.length})`}
            </TabsTrigger>
            <TabsTrigger value="requests" className="text-xs">
              Requests {requestConversations.length > 0 && `(${requestConversations.length})`}
            </TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value="known" className="flex-1 mt-0 min-h-0">
          {renderConversationList(knownConversations)}
        </TabsContent>
        
        <TabsContent value="requests" className="flex-1 mt-0 min-h-0">
          {renderConversationList(requestConversations)}
        </TabsContent>
      </Tabs>
    </Card>
  );
};
