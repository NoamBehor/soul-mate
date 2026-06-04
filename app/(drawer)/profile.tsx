import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';

const MOODS = ['😊', '😍', '😴', '😢', '😡', '🥳', '🤔', 'sick'];

export default function ProfileScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [myProfile, setMyProfile] = useState<any>(null);
  const [partnerProfile, setPartnerProfile] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setMyProfile({ my_nickname: 'Me', gender: 'female', partner_nickname: 'Partner', current_mood: '😊' });
      setPartnerProfile({ current_mood: '😍', mood_message: 'Happy' });
    } catch (error) {
      console.error('Error loading profiles:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateMood = async (mood: string) => {
    if (!myProfile) return;
    try {
      setMyProfile({ ...myProfile, current_mood: mood });
      Alert.alert('Mood Updated', `You're feeling ${mood}`);
    } catch (error) {
      console.error('Error updating mood:', error);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-rose-50">
        <ActivityIndicator size="large" color="#f43f5e" />
      </View>
    );
  }

  const gender = myProfile?.gender || 'female';
  const bgColor = gender === 'female' ? 'bg-pink-50' : 'bg-blue-50';
  const textColor = gender === 'female' ? 'text-rose-900' : 'text-blue-900';
  const cardColor = gender === 'female' ? 'bg-pink-100' : 'bg-blue-100';

  return (
    <ScrollView className={`flex-1 ${bgColor}`}>
      <View className="px-6 py-8 mt-12">
        <Text className={`text-2xl font-bold ${textColor} mb-6`}>Profiles</Text>

        {/* My Profile */}
        <View className={`p-6 rounded-3xl shadow-sm border border-white/40 mb-6 bg-white/80`}>
          <Text className="text-slate-500 mb-2">My Profile</Text>
          <View className="flex-row items-center mb-6">
            <View className="w-16 h-16 rounded-full bg-slate-100 items-center justify-center mr-4 border-2 border-rose-200">
               <Text className="text-3xl">{myProfile?.current_mood || '🙂'}</Text>
            </View>
            <View>
              <Text className={`font-bold text-xl ${textColor}`}>{myProfile?.my_nickname || 'Me'}</Text>
              <Text className="text-slate-500 text-sm">Status: Setting the mood...</Text>
            </View>
          </View>

          <Text className={`font-semibold ${textColor} mb-3`}>How are you feeling?</Text>
          <View className="flex-row flex-wrap justify-between">
            {MOODS.map(mood => (
              <TouchableOpacity 
                key={mood}
                onPress={() => handleUpdateMood(mood)}
                className={`w-12 h-12 rounded-full items-center justify-center mb-3 ${myProfile?.current_mood === mood ? 'bg-rose-200 border-2 border-rose-400' : 'bg-slate-100'}`}
              >
                <Text className="text-xl">{mood === 'sick' ? '🤒' : mood}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Partner Profile */}
        {partnerProfile && (
          <View className={`p-6 rounded-3xl shadow-sm border border-white/40 mb-6 ${cardColor}`}>
            <Text className="text-slate-500 mb-2">Partner's Profile</Text>
            <View className="flex-row items-center">
              <View className="w-16 h-16 rounded-full bg-white items-center justify-center mr-4 shadow-sm">
                <Text className="text-3xl">{partnerProfile.current_mood || '🙂'}</Text>
              </View>
              <View>
                <Text className={`font-bold text-xl ${textColor}`}>{myProfile?.partner_nickname || 'Partner'}</Text>
                {partnerProfile.mood_message && (
                  <Text className="text-sm text-slate-600 italic mt-1">"{partnerProfile.mood_message}"</Text>
                )}
              </View>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
