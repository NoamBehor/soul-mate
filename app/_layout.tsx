import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import '../global.css';
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotifications } from '@/src/hooks/useNotifications';

export const unstable_settings = {
  anchor: '(drawer)',
};

function RootNavigator() {
  const colorScheme = useColorScheme();
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const url = Linking.useURL();

  useNotifications();

  useEffect(() => {
    if (url) {
      const { hostname, path, queryParams } = Linking.parse(url);
      if ((path === 'join' || hostname === 'join') && queryParams?.pairId) {
        AsyncStorage.setItem('@soulsync_pending_pairId', queryParams.pairId as string)
          .then(() => console.log('Saved pending pairId:', queryParams.pairId))
          .catch(err => console.error('Error saving pending pairId:', err));
      }
    }
  }, [url]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'register';

    if (!user && !inAuthGroup) {
      // Redirect to register if the user is not authenticated
      router.replace('/register');
    } else if (user && inAuthGroup) {
      // Redirect to the dashboard if the user is authenticated
      router.replace('/(drawer)');
    }
  }, [user, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#f43f5e" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        <Stack.Screen name="register" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
