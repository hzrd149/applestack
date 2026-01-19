# Project Overview

This project is a Nostr client application built with React 18.x, TailwindCSS 3.x, Vite, shadcn/ui, and Applesauce.

## Technology Stack

- **React 18.x**: Stable version of React with hooks, concurrent rendering, and improved performance
- **TailwindCSS 3.x**: Utility-first CSS framework for styling
- **Vite**: Fast build tool and development server
- **shadcn/ui**: Unstyled, accessible UI components built with Radix UI and Tailwind
- **Applesauce**: Production-ready Nostr SDK with reactive architecture (used in noStrudel)
- **RxJS**: Reactive programming with observables for state management
- **React Router**: For client-side routing with BrowserRouter and ScrollToTop functionality
- **TypeScript**: For type-safe JavaScript development

## Project Structure

- `/docs/`: Specialized documentation for implementation patterns and features
- `/src/services/`: Core applesauce services (EventStore, RelayPool, loaders, accounts, actions, state)
- `/src/components/`: UI components
  - `/src/components/ui/`: shadcn/ui components (48+ components available)
  - `/src/components/auth/`: Authentication-related components (LoginArea, LoginDialog, AccountSwitcher, SignupDialog)
- `/src/hooks/`: Custom hooks including:
  - `use$`: Subscribe to RxJS observables
  - `useEventStore`: Access global EventStore
  - `useAccount`: Get currently logged-in account
  - `useProfile`: Fetch user profile data by pubkey (uses ProfileModel)
  - `useTimeline`: Subscribe to timeline with Note casts
  - `usePublish`: Publish events with EventTemplate
  - `useAction`: Execute pre-built actions (UpdateProfile, CreateNote, etc.)
  - `useTheme`: Theme management with RxJS observables
  - `useToast`: Toast notifications
  - `useLocalStorage`: Persistent local storage
  - `useLoggedInAccounts`: Manage multiple accounts
  - `useLoginActions`: Authentication actions (extension, nsec, bunker)
  - `useIsMobile`: Responsive design helper
  - `useUploadFile`: Upload files via Blossom servers
- `/src/blueprints/`: Custom event blueprints for standardized event creation
- `/src/operations/`: Custom event operations for composable event building
- `/src/pages/`: Page components used by React Router (Index, NotFound)
- `/src/lib/`: Utility functions and shared logic
- `/src/types/`: TypeScript type definitions (NostrMetadata, window.nostr)
- `/src/test/`: Testing utilities including TestApp component
- `/public/`: Static assets
- `App.tsx`: Main app component with provider setup (**CRITICAL**: this file is **already configured** with `EventStoreProvider`, `AccountsProvider`, `UnheadProvider` and other important providers - **read this file before making changes**. Changes are usually not necessary unless adding new providers. Changing this file may break the application)
- `AppRouter.tsx`: React Router configuration

**CRITICAL**: Always read the files mentioned above before making changes, as they contain important setup and configuration for the application. Never directly write to these files without first reading their contents.

## UI Components

The project uses shadcn/ui components located in `@/components/ui`. These are unstyled, accessible components built with Radix UI and styled with Tailwind CSS. Available components include:

- **Accordion**: Vertically collapsing content panels
- **Alert**: Displays important messages to users
- **AlertDialog**: Modal dialog for critical actions requiring confirmation
- **AspectRatio**: Maintains consistent width-to-height ratio
- **Avatar**: User profile pictures with fallback support
- **Badge**: Small status descriptors for UI elements
- **Breadcrumb**: Navigation aid showing current location in hierarchy
- **Button**: Customizable button with multiple variants and sizes
- **Calendar**: Date picker component
- **Card**: Container with header, content, and footer sections
- **Carousel**: Slideshow for cycling through elements
- **Chart**: Data visualization component
- **Checkbox**: Selectable input element
- **Collapsible**: Toggle for showing/hiding content
- **Command**: Command palette for keyboard-first interfaces
- **ContextMenu**: Right-click menu component
- **Dialog**: Modal window overlay
- **Drawer**: Side-sliding panel (using vaul)
- **DropdownMenu**: Menu that appears from a trigger element
- **Form**: Form validation and submission handling
- **HoverCard**: Card that appears when hovering over an element
- **InputOTP**: One-time password input field
- **Input**: Text input field
- **Label**: Accessible form labels
- **Menubar**: Horizontal menu with dropdowns
- **NavigationMenu**: Accessible navigation component
- **Pagination**: Controls for navigating between pages
- **Popover**: Floating content triggered by a button
- **Progress**: Progress indicator
- **RadioGroup**: Group of radio inputs
- **Resizable**: Resizable panels and interfaces
- **ScrollArea**: Scrollable container with custom scrollbars
- **Select**: Dropdown selection component
- **Separator**: Visual divider between content
- **Sheet**: Side-anchored dialog component
- **Sidebar**: Navigation sidebar component
- **Skeleton**: Loading placeholder
- **Slider**: Input for selecting a value from a range
- **Switch**: Toggle switch control
- **Table**: Data table with headers and rows
- **Tabs**: Tabbed interface component
- **Textarea**: Multi-line text input
- **Toast**: Toast notification component
- **ToggleGroup**: Group of toggle buttons
- **Toggle**: Two-state button
- **Tooltip**: Informational text that appears on hover

These components follow a consistent pattern using React's `forwardRef` and use the `cn()` utility for class name merging. Many are built on Radix UI primitives for accessibility and customized with Tailwind CSS.

## Documentation

The project includes a **`docs/`** directory containing specialized documentation for specific implementation tasks. You are encouraged to add new documentation files to help future development.

- **`docs/AI_CHAT.md`**: Read when building any AI-powered chat interfaces, implementing streaming responses, or integrating with the Shakespeare API.

- **`docs/NOSTR_COMMENTS.md`**: Read when implementing comment systems, adding discussion features to posts/articles, or building community interaction features.

- **`docs/NOSTR_INFINITE_SCROLL.md`**: Read when building feed interfaces, implementing pagination for Nostr events, or creating social media-style infinite scroll experiences.

- **`docs/NOSTR_DIRECT_MESSAGES.md`**: Read when implementing direct messaging features, building chat interfaces, or working with encrypted peer-to-peer communication (NIP-04 and NIP-17).

## System Prompt Management

The AI assistant's behavior and knowledge is defined by the AGENTS.md file, which serves as the system prompt. To modify the assistant's instructions or add new project-specific guidelines:

