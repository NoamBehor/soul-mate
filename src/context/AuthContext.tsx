import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { database, setPairId } from '../services/firebase';
import { ref, set, push, get, child, update, onValue } from 'firebase/database';

export type Gender = 'Male' | 'Female' | 'Other';

export interface UserData {
  id: string;
  fullName: string;
  partnerNickname: string;
  gender: Gender;
  email: string;
  phone: string;
  pairId: string;
  role: 'Partner A' | 'Partner B';
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  text: string;
  background: string;
  card: string;
}

const MALE_THEME: ThemeColors = {
  primary: '#3B82F6', // Blue
  secondary: '#DBEAFE',
  text: '#1E3A8A',
  background: '#EFF6FF',
  card: '#FFFFFF',
};

const FEMALE_THEME: ThemeColors = {
  primary: '#A855F7', // Purple
  secondary: '#F3E8FF',
  text: '#581C87',
  background: '#FAF5FF',
  card: '#FFFFFF',
};

const DEFAULT_THEME: ThemeColors = {
  primary: '#f43f5e', // Rose (fallback)
  secondary: '#ffe4e6',
  text: '#881337',
  background: '#fff1f2',
  card: '#FFFFFF',
};

interface AuthContextType {
  user: UserData | null;
  themeColors: ThemeColors;
  myId: string | null;
  partnerId: string | null;
  registerUser: (data: Omit<UserData, 'id' | 'role' | 'pairId'> & { pairId?: string }) => Promise<void>;
  pairManually: (partnerId: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AUTH_STORAGE_KEY = '@soulsync_user';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const storedUser = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser) as UserData;
          setUser(parsedUser);
          setPairId(parsedUser.pairId);
        }
      } catch (error) {
        console.error('Failed to load user:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadUser();
  }, []);

  // Listen to current user's document in Firebase to automatically sync pairId updates
  useEffect(() => {
    if (!user?.id) return;

    const userRef = ref(database, `users/${user.id}`);
    const unsubscribe = onValue(userRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setUser((prevUser) => {
          if (!prevUser) return prevUser;
          // Trigger update if pairId changed remotely
          if (prevUser.pairId !== data.pairId) {
            const updatedUser = { 
              ...prevUser, 
              pairId: data.pairId || '' 
            };
            AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updatedUser)).catch(console.error);
            setPairId(data.pairId || '');
            return updatedUser;
          }
          return prevUser;
        });
      }
    });

    return () => unsubscribe();
  }, [user?.id]);

  const registerUser = async (data: Omit<UserData, 'id' | 'role' | 'pairId'> & { pairId?: string }) => {
    try {
      // Generate a new user ID
      const usersRef = ref(database, 'users');
      const newUserRef = push(usersRef);
      const newUserId = newUserRef.key;

      if (!newUserId) throw new Error("Failed to generate user ID");

      const assignedPairId = data.pairId || '';
      const role = assignedPairId ? 'Partner B' : 'Partner A';

      if (assignedPairId) {
        setPairId(assignedPairId);
      }

      const newUserData: UserData = {
        fullName: data.fullName,
        partnerNickname: data.partnerNickname,
        gender: data.gender,
        email: data.email,
        phone: data.phone,
        id: newUserId,
        pairId: assignedPairId,
        role: role
      };

      // Save to Firebase
      await set(ref(database, `users/${newUserId}`), newUserData);

      // Mutually link the inviting user to this new user
      if (assignedPairId) {
        await set(ref(database, `users/${assignedPairId}/pairId`), newUserId);
      }

      // Save locally
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newUserData));
      setUser(newUserData);
    } catch (error) {
      console.error('Failed to register user:', error);
      throw error;
    }
  };

  const pairManually = async (partnerIdStr: string) => {
    if (!user || !user.id) throw new Error("Not logged in");
    if (!partnerIdStr) throw new Error("Partner ID is required");

    try {
      const partnerRef = ref(database, `users/${partnerIdStr}`);
      const partnerSnapshot = await get(partnerRef);
      if (!partnerSnapshot.exists()) {
        throw new Error("Partner not found. Check the code and try again.");
      }

      await update(ref(database, `users/${user.id}`), { pairId: partnerIdStr });
      await update(ref(database, `users/${partnerIdStr}`), { pairId: user.id });

      const updatedUser = { ...user, pairId: partnerIdStr };
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updatedUser));
      setUser(updatedUser);
      setPairId(partnerIdStr);
    } catch (error) {
      console.error('Failed to pair manually:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      setUser(null);
      setPairId('Noam_Bar_2026'); // Reset to default
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  const themeColors = user 
    ? (user.gender === 'Male' ? MALE_THEME : (user.gender === 'Female' ? FEMALE_THEME : DEFAULT_THEME))
    : DEFAULT_THEME;

  const myId = user?.id || null;
  const partnerId = user?.pairId || null;

  return (
    <AuthContext.Provider value={{ user, themeColors, myId, partnerId, registerUser, pairManually, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
