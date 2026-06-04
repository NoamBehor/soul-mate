import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import Slider from '@react-native-community/slider';
import { useAuth } from '@/src/context/AuthContext';
import { onValue, set, ref, database } from '@/src/services/firebase';
import { getCycleData } from '@/src/utils/cycleLogic';
import { subscribeToCycleLogs, CycleLog } from '@/src/services/cycleService';
const MOODS = ['😊', '😍', '😴', '😢', '😡', '🥳', '😎', '🤒'];

export default function HomeScreen() {
  const { user, themeColors, myId, partnerId } = useAuth();
  const role = user?.role || 'Partner A';
  const partnerNickname = user?.partnerNickname || (role === 'Partner A' ? 'Bary' : 'Noam');

  const isFemale = user?.gender === 'Female';
  const isMale = user?.gender === 'Male';

  // Real cycle data from Firebase
  const [cycleLogs, setCycleLogs] = useState<CycleLog[]>([]);
  const cycleData = getCycleData(cycleLogs.length > 0 ? cycleLogs : null);
  // Default energy/mood immediately so UI never spins waiting for Firebase
  const [myEnergy, setMyEnergy] = useState<number>(3);
  const [myMood, setMyMood] = useState<string>('😊');

  const [partnerProfile, setPartnerProfile] = useState<any>({
    partner_nickname: partnerNickname,
    current_mood: '...',
    current_energy: null,
  });

  const [isLoading, setIsLoading] = useState(true);
  const isSliding = React.useRef(false);

  // ── Check 5: memoised pairId — one stable value used by both useEffects
  const pairId = useMemo(
    () => (partnerId ? [myId, partnerId].sort().join('_') : myId ?? myId ?? ''),
    [myId, partnerId],
  );

  useEffect(() => {
    if (!myId) return;
    const unsub = subscribeToCycleLogs(pairId, setCycleLogs);
    return () => unsub();
  }, [pairId]);

  useEffect(() => {
    if (!myId) {
      setIsLoading(false);
      return;
    }

    const statusRef = ref(database, `status/${pairId}`);

    // Fallbacks just in case data loads slowly
    setPartnerProfile((prev: any) => ({
      ...prev,
      partner_nickname: partnerNickname
    }));

    const unsubscribe = onValue(statusRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data[myId]) {
          setMyEnergy(data[myId].energy !== undefined ? data[myId].energy : 3);
          setMyMood(data[myId].mood || '😊');
        }

        if (partnerId && data[partnerId]) {
          setPartnerProfile((prev: any) => ({
            ...prev,
            current_mood: data[partnerId].mood || '...',
            current_energy: data[partnerId].energy !== undefined ? data[partnerId].energy : 3,
          }));
        } else if (partnerId) {
          setPartnerProfile((prev: any) => ({
            ...prev,
            current_mood: '⏳',
            current_energy: null,
          }));
        }
      } else {
        if (partnerId) {
          setPartnerProfile((prev: any) => ({
            ...prev,
            current_mood: '⏳',
            current_energy: null,
          }));
        }
      }
      setIsLoading(false);
    }, (error) => {
      console.error('Firebase mood index error:', error);
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, [myId, pairId, partnerId, partnerNickname]);

  const getEnergyLabel = (val: number) => {
    if (val === 1) return 'Exhausted';
    if (val === 2) return 'Chill';
    if (val === 3) return 'Normal';
    if (val === 4) return 'Active';
    if (val === 5) return 'On Fire';
    return '';
  };

  const syncStatus = async (mood: string, energy: number) => {
    if (!myId) return;
    const myStatusRef = ref(database, `status/${pairId}/${myId}`);
    await set(myStatusRef, { mood, energy });
  };

  const handleUpdateMood = (mood: string) => {
    setMyMood(mood);
    if (myEnergy !== null) {
      syncStatus(mood, myEnergy);
    }
  };

  const handleUpdateEnergyComplete = (energy: number) => {
    if (myMood !== null) {
      syncStatus(myMood, energy);
    }
  };

  // ── Check 5 / Area 6: only block on isLoading — myEnergy and myMood now
  // default immediately so they never hold the spinner indefinitely.
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: themeColors.background }}>
        <ActivityIndicator size="large" color={themeColors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: themeColors.background }}>
      <View className="px-6 py-8">
        <Text style={{ fontSize: 24, fontWeight: 'bold', color: themeColors.text, marginBottom: 24 }}>Home</Text>

        {/* Cycle Tracking Banner */}
        {(isFemale || isMale) && (
          <View style={{ padding: 20, borderRadius: 20, backgroundColor: cycleData.color, marginBottom: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 }}>
            <View className="flex-row items-center mb-2">
              <Text style={{ fontSize: 22, marginRight: 8 }}>{isFemale ? '🌸' : '💡'}</Text>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#4A148C' }}>
                Cycle Phase: {cycleData.phase}
              </Text>
            </View>
            {isFemale ? (
              <Text style={{ fontSize: 15, color: '#4A148C', marginTop: 4, fontWeight: '500' }}>
                {cycleData.daysRemaining} days remaining in this phase.
              </Text>
            ) : (
              <Text style={{ fontSize: 14, color: '#4A148C', marginTop: 4, fontStyle: 'italic', lineHeight: 20 }}>
                Pro-tip: {cycleData.proTip}
              </Text>
            )}
          </View>
        )}

        {/* My Status Section */}
        <View style={{ padding: 24, borderRadius: 24, backgroundColor: themeColors.card, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 15, elevation: 2, marginBottom: 24, borderColor: themeColors.secondary, borderWidth: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: themeColors.text, marginBottom: 8 }}>My Status</Text>

          {/* Energy Slider */}
          <Text style={{ fontWeight: '600', color: themeColors.text, marginBottom: 4, marginTop: 16 }}>My Energy: {getEnergyLabel(Math.round(myEnergy))}</Text>
          <Slider
            style={{ width: '100%', height: 40 }}
            minimumValue={1}
            maximumValue={5}
            step={1}
            value={myEnergy}
            onValueChange={setMyEnergy}
            onSlidingStart={() => {
              isSliding.current = true;
            }}
            onSlidingComplete={(energy) => {
              if (!isSliding.current) return;
              isSliding.current = false;
              handleUpdateEnergyComplete(energy);
            }}
            minimumTrackTintColor={themeColors.primary}
            maximumTrackTintColor={themeColors.secondary}
            thumbTintColor={themeColors.primary}
          />
          <View className="flex-row justify-between px-2 mb-4">
            <Text className="text-xs text-slate-500">Chill</Text>
            <Text className="text-xs text-slate-500">On Fire</Text>
          </View>

          {/* Mood Picker */}
          <Text style={{ fontWeight: '600', color: themeColors.text, marginBottom: 12 }}>My Mood</Text>
          <View className="flex-row flex-wrap justify-between">
            {MOODS.map(mood => (
              <TouchableOpacity
                key={mood}
                onPress={() => handleUpdateMood(mood)}
                style={[
                  { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
                  myMood === mood 
                    ? { backgroundColor: themeColors.secondary, borderColor: themeColors.primary, borderWidth: 2 } 
                    : { backgroundColor: '#f1f5f9' }
                ]}
              >
                <Text className="text-2xl">{mood}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Partner Status Section */}
        {partnerId && (
          <View style={{ padding: 24, borderRadius: 24, backgroundColor: themeColors.secondary, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 15, elevation: 2, marginBottom: 24 }}>
            <Text style={{ color: themeColors.text, marginBottom: 8, opacity: 0.8 }}>{partnerProfile.partner_nickname}'s Status</Text>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <View className="w-16 h-16 rounded-full bg-white items-center justify-center mr-4 shadow-sm">
                  <Text className="text-3xl">{partnerProfile.current_mood}</Text>
                </View>
                <View>
                  <Text style={{ fontWeight: 'bold', fontSize: 20, color: themeColors.text }}>{partnerProfile.partner_nickname}</Text>
                  {partnerProfile.current_energy !== null ? (
                    <Text style={{ fontSize: 14, color: themeColors.text, fontStyle: 'italic', marginTop: 4, opacity: 0.8 }}>Energy: {getEnergyLabel(partnerProfile.current_energy)}</Text>
                  ) : (
                    <Text style={{ fontSize: 14, color: themeColors.text, fontStyle: 'italic', marginTop: 4, opacity: 0.8 }}>Waiting for partner update...</Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        )}

      </View>
    </ScrollView>
  );
}
