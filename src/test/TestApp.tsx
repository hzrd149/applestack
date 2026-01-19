import { useMemo } from 'react';
import { createHead, UnheadProvider } from '@unhead/react/client';
import { BrowserRouter } from 'react-router-dom';
import { EventStoreProvider, AccountsProvider } from 'applesauce-react/providers';
import { EventStore } from 'applesauce-core';
import { AccountManager } from 'applesauce-accounts';

interface TestAppProps {
  children: React.ReactNode;
}

export function TestApp({ children }: TestAppProps) {
  const head = createHead();

  // Create isolated test instances
  const eventStore = useMemo(() => new EventStore(), []);
  const accountManager = useMemo(() => new AccountManager(), []);

  return (
    <UnheadProvider head={head}>
      <EventStoreProvider eventStore={eventStore}>
        <AccountsProvider manager={accountManager}>
          <BrowserRouter>
            {children}
          </BrowserRouter>
        </AccountsProvider>
      </EventStoreProvider>
    </UnheadProvider>
  );
}

export default TestApp;