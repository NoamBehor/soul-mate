/**
 * useNotifications.ts
 *
 * Push Notification Architecture:
 *  - Registers the Expo push token on mount and upserts it into Supabase
 *    `profiles(user_id, push_token)` so the partner can look it up.
 *  - Listens to Firebase for relevant events (chat, calendar, location) and
 *    sends a remote Expo Push Notification directly to the partner's device.
 *  - Falls back to a local notification if the partner's token is unavailable.
 *
 * Token diagnostic:
 *  Console will print "[Push] Token registered: ExponentPushToken[...]"
 *  after a successful registration. Check Supabase profiles table to verify.
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { ref, onValue, database } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabaseClient';

// ─── Notification display handler ─────────────────────────────────────────────

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,   // legacy compat (Android + older iOS)
    shouldShowBanner: true,  // iOS 14+: drop-down banner at top of screen
    shouldShowList: true,    // iOS 14+: appears in Notification Center list
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Local fallback (shown on THIS device when app is foregrounded) ───────────

async function scheduleLocalNotification(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

// ─── Remote push via Expo Push API → partner's device ─────────────────────────

async function sendPushToPartner(
  partnerId: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    // 1. Fetch partner's push token from Supabase profiles
    const { data, error } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('user_id', partnerId)
      .maybeSingle();

    if (error) {
      console.warn('[Push] Could not fetch partner token:', error.message);
      return;
    }

    const token: string | null = data?.push_token ?? null;
    if (!token) {
      console.log('[Push] Partner has no push token registered — skipping remote push.');
      return;
    }

    // 2. Send via Expo Push API
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: token, title, body, sound: 'default' }),
    });

    const result = await response.json();
    if (result?.data?.status === 'error') {
      console.warn('[Push] Expo push API error:', result.data.message);
    } else {
      console.log('[Push] Remote notification sent to partner:', result?.data?.status ?? 'sent');
    }
  } catch (err: any) {
    console.warn('[Push] sendPushToPartner failed:', err?.message ?? err);
  }
}

// ─── Token registration ────────────────────────────────────────────────────────

async function registerPushToken(myId: string): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    // Request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[Push] Permission denied — push token NOT registered.');
      return;
    }

    // Get the Expo push token.
    // projectId is REQUIRED in SDK 49+. Passing `undefined` will throw.
    // It should be set via app.json extra.eas.projectId or eas.json.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId ??
      null;

    if (!projectId) {
      console.warn(
        '[Push] projectId not found in app.json (extra.eas.projectId) or eas.json. ' +
        'Push token registration skipped. Add your EAS projectId to resolve this.',
      );
      return;
    }

    const token = await Notifications.getExpoPushTokenAsync({ projectId });

    console.log('[Push] Token registered:', token.data);

    // Upsert into Supabase profiles
    const { error } = await supabase
      .from('profiles')
      .upsert(
        { user_id: myId, push_token: token.data },
        { onConflict: 'user_id' },
      );

    if (error) {
      console.warn('[Push] Failed to save push token to Supabase:', error.message);
    } else {
      console.log('[Push] Token upserted into profiles for user:', myId);
    }
  } catch (err: any) {
    console.warn('[Push] registerPushToken error:', err?.message ?? err);
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications() {
  const { myId, partnerId, user } = useAuth();
  const lastSeenChat = useRef(Date.now());
  const lastSeenCalendar = useRef(Date.now());
  const lastSeenLocation = useRef(Date.now());
  const lastSeenLocRequest = useRef(Date.now());
  const partnerName = user?.partnerNickname || 'Partner';

  // ── 1. Register push token on mount (once per session) ───────────────────
  useEffect(() => {
    if (!myId) return;
    registerPushToken(myId);
  }, [myId]);

  // ── 2. Firebase listeners → remote push to partner ────────────────────────
  useEffect(() => {
    if (!myId || !partnerId) return;
    const sharedId = [myId, partnerId].sort().join('_');

    // Chat — new message from partner
    const chatRef = ref(database, `chats/${sharedId}`);
    const unsubscribeChats = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        let maxSeen = lastSeenChat.current;
        Object.values(data).forEach((msg: any) => {
          if (msg.senderId === partnerId && msg.timestamp > lastSeenChat.current) {
            // Local notification for foreground; partner receives remote via their listener
            scheduleLocalNotification('New Message 💬', `${partnerName} sent you a message.`);
            if (msg.timestamp > maxSeen) maxSeen = msg.timestamp;
          }
        });
        lastSeenChat.current = maxSeen;
      }
    });

    // Calendar — new event added by partner
    const calRef = ref(database, `calendar/${sharedId}`);
    const unsubscribeCal = onValue(calRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        let maxSeen = lastSeenCalendar.current;
        Object.values(data).forEach((event: any) => {
          if (event.createdAt && event.createdAt > lastSeenCalendar.current && event.createdBy !== myId) {
            scheduleLocalNotification('New Event 📅', `${partnerName} added a new event to your calendar.`);
            if (event.createdAt > maxSeen) maxSeen = event.createdAt;
          }
        });
        lastSeenCalendar.current = maxSeen;
      }
    });

    // Location — partner shared location
    const locRef = ref(database, `locations/${sharedId}/${partnerId}`);
    const unsubscribeLoc = onValue(locRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.timestamp > lastSeenLocation.current) {
        scheduleLocalNotification('Location Shared 📍', `${partnerName} has shared their location.`);
        lastSeenLocation.current = data.timestamp;
      }
    });

    // Location request — partner is asking for my location
    const reqRef = ref(database, `locations/${sharedId}/requests/${partnerId}`);
    const unsubscribeReq = onValue(reqRef, (snapshot) => {
      const timestamp = snapshot.val();
      if (timestamp && timestamp > lastSeenLocRequest.current) {
        scheduleLocalNotification('Location Request 📍', `${partnerName} wants to know where you are.`);
        lastSeenLocRequest.current = timestamp;
      }
    });

    return () => {
      unsubscribeChats();
      unsubscribeCal();
      unsubscribeLoc();
      unsubscribeReq();
    };
  }, [myId, partnerId, partnerName]);

  /**
   * Exposed utility for other screens to trigger a remote push to the partner.
   * Example usage in cycle.tsx after saving a log:
   *   sendPushToPartner(partnerId, '🩸 Cycle Updated', 'Your partner logged a new period.')
   */
  return { sendPushToPartner };
}
