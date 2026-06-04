import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, TouchableOpacity, Share, Alert, Platform, TextInput } from 'react-native';
import { Bell, MapPin, Shield, HelpCircle, LogOut, ChevronRight, Users, Link as LinkIcon } from 'lucide-react-native';
import { useAuth } from '@/src/context/AuthContext';
import { database } from '@/src/services/firebase';
import { ref, update } from 'firebase/database';
import * as Clipboard from 'expo-clipboard';

export default function SettingsScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [locationSharingEnabled, setLocationSharingEnabled] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [partnerCode, setPartnerCode] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  
  const { user, logout, themeColors, pairManually } = useAuth();

  const myName = user?.fullName || 'User';
  const partnerName = user?.partnerNickname || 'Partner';
  const role = user?.role || 'Partner A';

  const handleInvite = async () => {
    if (!user?.id) {
      Alert.alert('Error', 'Could not generate link. User ID is missing.');
      return;
    }

    setIsInviting(true);
    const inviteUrl = `soulsync://join?pairId=${user.id}`;
    try {
      // Create a dedicated field to track pending invitations in Firebase
      const userRef = ref(database, `users/${user.id}`);
      await update(userRef, {
        pendingInvitation: true,
        inviteUrl: inviteUrl,
      });

      if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(inviteUrl);
        Alert.alert('Success', 'Link copied to clipboard! Share it with your partner.');
      } else {
        await Share.share({
          message: `Join me on SoulSync! Click here to connect: ${inviteUrl}`,
          url: inviteUrl,
        });
      }
    } catch (error) {
      console.error('Error sharing:', error);
      Alert.alert('Error', 'Could not generate or share the invitation link. Please try again.');
    } finally {
      setTimeout(() => setIsInviting(false), 1000);
    }
  };

  const handleManualPair = async () => {
    if (!partnerCode.trim()) {
      Alert.alert('Error', 'Please enter a valid code');
      return;
    }
    setIsConnecting(true);
    try {
      await pairManually(partnerCode.trim());
      Alert.alert('Success', 'Successfully paired with your partner!');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to connect. Please check the code.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: themeColors.background }}>
      <View className="px-6 py-8">
        <Text style={{ fontSize: 24, fontWeight: 'bold', color: themeColors.text, marginBottom: 32 }}>Settings & Profile</Text>

        {/* Profile Card Summary */}
        <View style={{ backgroundColor: themeColors.card, padding: 20, borderRadius: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 32, borderColor: themeColors.secondary, borderWidth: 1 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: themeColors.secondary, alignItems: 'center', justifyContent: 'center', marginRight: 16 }}>
            <Text className="text-2xl">{user?.gender === 'Female' ? '👩' : user?.gender === 'Male' ? '👨' : '😊'}</Text>
          </View>
          <View className="flex-1">
            <Text style={{ fontSize: 20, fontWeight: 'bold', color: themeColors.text }}>{myName}</Text>
            <Text style={{ color: themeColors.text, opacity: 0.7 }}>
              {user?.pairId ? `Paired with ${partnerName} 💕` : 'Not paired yet'}
            </Text>
          </View>
          <TouchableOpacity style={{ backgroundColor: themeColors.secondary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
            <Text style={{ color: themeColors.primary, fontWeight: '500', fontSize: 14 }}>Edit</Text>
          </TouchableOpacity>
        </View>

        {!user?.pairId && (
          <View>
            <TouchableOpacity 
              style={{ backgroundColor: isInviting ? themeColors.secondary : themeColors.primary, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, marginBottom: 16, shadowColor: themeColors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 }}
              onPress={handleInvite}
              disabled={isInviting}
            >
              <LinkIcon size={20} color={isInviting ? themeColors.primary : "#ffffff"} className="mr-2" />
              <Text style={{ color: isInviting ? themeColors.primary : "#ffffff", fontWeight: 'bold', fontSize: 16 }}>
                {isInviting ? 'Generating...' : 'Invite your Partner'}
              </Text>
            </TouchableOpacity>

            <View style={{ alignItems: 'center', marginBottom: 32 }}>
              <Text style={{ color: themeColors.text, opacity: 0.7, marginBottom: 4 }}>Your Invite Code:</Text>
              <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 18, letterSpacing: 1 }} selectable={true}>{user?.id}</Text>
            </View>

            <View style={{ backgroundColor: themeColors.card, borderRadius: 16, padding: 16, marginBottom: 32, borderColor: themeColors.secondary, borderWidth: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: themeColors.text, marginBottom: 12 }}>Enter Partner's Code</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TextInput 
                  style={{ flex: 1, backgroundColor: themeColors.background, borderRadius: 8, padding: 12, marginRight: 12, color: themeColors.text }}
                  placeholder="Paste code here"
                  placeholderTextColor={themeColors.text + '80'}
                  value={partnerCode}
                  onChangeText={setPartnerCode}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity 
                  style={{ backgroundColor: themeColors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8 }}
                  onPress={handleManualPair}
                  disabled={isConnecting}
                >
                  <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>{isConnecting ? '...' : 'Connect'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        <Text className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3 ml-1">Debugging / Sync</Text>
        <View style={{ backgroundColor: themeColors.card, borderRadius: 16, marginBottom: 32, overflow: 'hidden', borderColor: themeColors.secondary, borderWidth: 1 }}>
          <View className="flex-row items-center justify-between p-4">
            <View className="flex-row items-center">
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: themeColors.secondary, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Users size={18} color={themeColors.primary} />
              </View>
              <Text style={{ fontSize: 16, color: themeColors.text, fontWeight: '500' }}>Role: {role}</Text>
            </View>
          </View>
        </View>

        <Text className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3 ml-1">Preferences</Text>
        
        <View style={{ backgroundColor: themeColors.card, borderRadius: 16, marginBottom: 32, overflow: 'hidden', borderColor: themeColors.secondary, borderWidth: 1 }}>
          {/* Notifications Toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: themeColors.secondary }}>
            <View className="flex-row items-center">
              <View className="w-8 h-8 rounded-full bg-indigo-50 items-center justify-center mr-3">
                <Bell size={18} color="#6366f1" />
              </View>
              <Text style={{ fontSize: 16, color: themeColors.text, fontWeight: '500' }}>Notifications</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: '#cbd5e1', true: themeColors.secondary }}
              thumbColor={notificationsEnabled ? themeColors.primary : '#f8fafc'}
            />
          </View>

          {/* Location Sharing Toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
            <View className="flex-row items-center">
              <View className="w-8 h-8 rounded-full bg-emerald-50 items-center justify-center mr-3">
                <MapPin size={18} color="#10b981" />
              </View>
              <Text style={{ fontSize: 16, color: themeColors.text, fontWeight: '500' }}>Location Sharing</Text>
            </View>
            <Switch
              value={locationSharingEnabled}
              onValueChange={setLocationSharingEnabled}
              trackColor={{ false: '#cbd5e1', true: themeColors.secondary }}
              thumbColor={locationSharingEnabled ? themeColors.primary : '#f8fafc'}
            />
          </View>
        </View>

        <Text className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3 ml-1">Support & Privacy</Text>

        <View style={{ backgroundColor: themeColors.card, borderRadius: 16, marginBottom: 32, overflow: 'hidden', borderColor: themeColors.secondary, borderWidth: 1 }}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: themeColors.secondary }}>
            <View className="flex-row items-center">
              <View className="w-8 h-8 rounded-full bg-amber-50 items-center justify-center mr-3">
                <Shield size={18} color="#f59e0b" />
              </View>
              <Text style={{ fontSize: 16, color: themeColors.text, fontWeight: '500' }}>Privacy Policy</Text>
            </View>
            <ChevronRight size={20} color="#cbd5e1" />
          </TouchableOpacity>

          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
            <View className="flex-row items-center">
              <View className="w-8 h-8 rounded-full bg-sky-50 items-center justify-center mr-3">
                <HelpCircle size={18} color="#0ea5e9" />
              </View>
              <Text style={{ fontSize: 16, color: themeColors.text, fontWeight: '500' }}>Help & Support</Text>
            </View>
            <ChevronRight size={20} color="#cbd5e1" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={{ backgroundColor: themeColors.card, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, borderColor: '#fecdd3', borderWidth: 1, marginBottom: 32 }}
          onPress={logout}
        >
          <LogOut size={20} color="#ef4444" className="mr-2" />
          <Text className="text-rose-500 font-bold text-base">Sign Out</Text>
        </TouchableOpacity>

      </View>
    </ScrollView>
  );
}
