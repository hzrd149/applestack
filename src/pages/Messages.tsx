import { useSeoMeta } from '@unhead/react';
import { MessagingInterface } from '@/components/dm/MessagingInterface';

const Messages = () => {
  useSeoMeta({
    title: 'Messages',
    description: 'Private encrypted messaging on Nostr',
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 h-screen flex flex-col">
        <MessagingInterface className="flex-1" />
      </div>
    </div>
  );
};

export default Messages;
