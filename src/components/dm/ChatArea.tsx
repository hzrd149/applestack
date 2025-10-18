import { useState, useRef, useEffect } from 'react';
import { useConversationMessages, useDMContext } from '@/contexts/DMContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { MESSAGE_PROTOCOL } from '@/lib/dmConstants';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatAreaProps {
  pubkey: string | null;
  onBack?: () => void;
  className?: string;
}

function MessageBubble({ 
  message, 
  isFromCurrentUser 
}: { 
  message: {
    id: string;
    decryptedContent?: string;
    error?: string;
    created_at: number;
    isSending?: boolean;
  };
  isFromCurrentUser: boolean;
}) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={cn("flex mb-4", isFromCurrentUser ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[70%] rounded-lg px-4 py-2",
        isFromCurrentUser 
          ? "bg-primary text-primary-foreground" 
          : "bg-muted"
      )}>
        {message.error ? (
          <p className="text-sm italic opacity-70">🔒 Failed to decrypt</p>
        ) : (
          <p className="text-sm whitespace-pre-wrap break-words">
            {message.decryptedContent}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className={cn(
            "text-xs opacity-70",
            isFromCurrentUser ? "text-primary-foreground" : "text-muted-foreground"
          )}>
            {formatTime(message.created_at)}
          </span>
          {message.isSending && (
            <Loader2 className="h-3 w-3 animate-spin opacity-70" />
          )}
        </div>
      </div>
    </div>
  );
}

function ChatHeader({ pubkey, onBack }: { pubkey: string; onBack?: () => void }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;

  const displayName = metadata?.name || genUserName(pubkey);
  const avatarUrl = metadata?.picture;
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="p-4 border-b flex items-center gap-3">
      {onBack && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="md:hidden"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}
      
      <Avatar className="h-10 w-10">
        <AvatarImage src={avatarUrl} alt={displayName} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      
      <div className="flex-1 min-w-0">
        <h2 className="font-semibold truncate">{displayName}</h2>
        {metadata?.nip05 && (
          <p className="text-xs text-muted-foreground truncate">{metadata.nip05}</p>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center text-muted-foreground max-w-sm">
        <p className="text-sm">Select a conversation to start messaging</p>
        <p className="text-xs mt-2">
          Your messages are encrypted and stored locally
        </p>
      </div>
    </div>
  );
}

function ChatAreaSkeleton() {
  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      
      <div className="flex-1 p-4 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className={cn("flex", i % 2 === 0 ? "justify-end" : "justify-start")}>
            <Skeleton className="h-16 w-64 rounded-lg" />
          </div>
        ))}
      </div>
      
      <div className="p-4 border-t">
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}

export function ChatArea({ pubkey, onBack, className }: ChatAreaProps) {
  const { user } = useCurrentUser();
  const { sendMessage, isNIP17Enabled } = useDMContext();
  const { messages, totalCount } = useConversationMessages(pubkey || '');
  
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages.length]);

  const handleSend = async () => {
    if (!messageText.trim() || !pubkey || !user) return;

    setIsSending(true);
    try {
      await sendMessage({
        recipientPubkey: pubkey,
        content: messageText.trim(),
        protocol: isNIP17Enabled ? MESSAGE_PROTOCOL.NIP17 : MESSAGE_PROTOCOL.NIP04,
      });
      setMessageText('');
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!pubkey) {
    return (
      <Card className={cn("h-full", className)}>
        <EmptyState />
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className={cn("h-full flex items-center justify-center", className)}>
        <div className="text-center text-muted-foreground">
          <p className="text-sm">Please log in to view messages</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("h-full flex flex-col", className)}>
      <ChatHeader pubkey={pubkey} onBack={onBack} />
      
      <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="text-sm">No messages yet</p>
              <p className="text-xs mt-1">Send a message to start the conversation</p>
            </div>
          </div>
        ) : (
          <div>
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isFromCurrentUser={message.pubkey === user.pubkey}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      
      <div className="p-4 border-t">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={isNIP17Enabled ? "default" : "secondary"} className="text-xs">
            {isNIP17Enabled ? "NIP-17 (Private)" : "NIP-04 (Legacy)"}
          </Badge>
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {totalCount} message{totalCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        
        <div className="flex gap-2">
          <Textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            className="min-h-[80px] resize-none"
            disabled={isSending}
          />
          <Button
            onClick={handleSend}
            disabled={!messageText.trim() || isSending}
            size="icon"
            className="h-[80px] w-[80px]"
          >
            {isSending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

