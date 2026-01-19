import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useActiveAccount } from 'applesauce-react/hooks';
import { useMyProfile } from '@/hooks/useProfile';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { runner, Actions } from '@/services/actions';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import type { NostrMetadata } from '@/types/nostr';
import { z } from 'zod';

// Validation schema for profile metadata
const metadataSchema = z.object({
  name: z.string().optional(),
  about: z.string().optional(),
  picture: z.string().url().optional().or(z.literal('')),
  banner: z.string().url().optional().or(z.literal('')),
  website: z.string().url().optional().or(z.literal('')),
  nip05: z.string().optional(),
  bot: z.boolean().optional(),
});

export const EditProfileForm: React.FC = () => {
  const activeAccount = useActiveAccount();
  const profile = useMyProfile();
  const { toast } = useToast();

  // Initialize the form with default values
  const form = useForm<NostrMetadata>({
    resolver: zodResolver(metadataSchema),
    defaultValues: {
      name: '',
      about: '',
      picture: '',
      banner: '',
      website: '',
      nip05: '',
      bot: false,
    },
  });

  // Update form values when user data is loaded
  useEffect(() => {
    if (profile) {
      form.reset({
        name: profile.name || '',
        about: profile.about || '',
        picture: profile.picture || '',
        banner: profile.banner || '',
        website: profile.website || '',
        nip05: profile.nip05 || '',
        bot: profile.bot || false,
      });
    }
  }, [profile, form]);

  const [isPending, setIsPending] = React.useState(false);

  const onSubmit = async (values: NostrMetadata) => {
    if (!activeAccount) {
      toast({
        title: 'Error',
        description: 'You must be logged in to update your profile',
        variant: 'destructive',
      });
      return;
    }

    setIsPending(true);

      try {
        // Combine existing metadata with new values
        const data = { ...profile, ...values };

        // Clean up empty values
        const cleanData: Record<string, string | boolean> = {};
        for (const key in data) {
          if (data[key] !== '' && data[key] !== undefined) {
            cleanData[key] = data[key];
          }
        }

        // Use UpdateProfile action from applesauce-actions
        await runner.run(Actions.UpdateProfile, cleanData);

        toast({
          title: 'Success',
          description: 'Your profile has been updated',
        });
      } catch (error) {
      console.error('Failed to update profile:', error);
      toast({
        title: 'Error',
        description: 'Failed to update your profile. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Your name" {...field} />
              </FormControl>
              <FormDescription>
                This is your display name that will be displayed to others.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="about"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bio</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Tell others about yourself"
                  className="resize-none"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                A short description about yourself.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="picture"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Profile Picture URL</FormLabel>
                <FormControl>
                  <Input placeholder="https://example.com/profile.jpg" {...field} />
                </FormControl>
                <FormDescription>
                  URL to your profile picture.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="banner"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Banner Image URL</FormLabel>
                <FormControl>
                  <Input placeholder="https://example.com/banner.jpg" {...field} />
                </FormControl>
                <FormDescription>
                  URL to a wide banner image for your profile.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Website</FormLabel>
                <FormControl>
                  <Input placeholder="https://yourwebsite.com" {...field} />
                </FormControl>
                <FormDescription>
                  Your personal website or social media link.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="nip05"
            render={({ field }) => (
              <FormItem>
                <FormLabel>NIP-05 Identifier</FormLabel>
                <FormControl>
                  <Input placeholder="you@example.com" {...field} />
                </FormControl>
                <FormDescription>
                  Your verified Nostr identifier.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="bot"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Bot Account</FormLabel>
                <FormDescription>
                  Mark this account as automated or a bot.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <Button
          type="submit"
          className="w-full md:w-auto"
          disabled={isPending}
        >
          {isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Save Profile
        </Button>
      </form>
    </Form>
  );
};
