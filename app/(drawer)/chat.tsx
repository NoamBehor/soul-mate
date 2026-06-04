import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Send } from 'lucide-react-native';
import { useAuth } from '@/src/context/AuthContext';
import { ref, onValue, push, set, database } from '@/src/services/firebase';

export default function ChatScreen() {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const { myId, partnerId, themeColors } = useAuth();

  useEffect(() => {
    if (!myId) {
      setIsLoading(false);
      return;
    }
    const sharedId = partnerId ? [myId, partnerId].sort().join('_') : myId;
    const chatRef = ref(database, `chats/${sharedId}`);
    
    const unsubscribe = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const msgList = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        })).sort((a, b) => a.timestamp - b.timestamp);
        setMessages(msgList);
      } else {
        setMessages([]);
      }
      setIsLoading(false);
    }, (error) => {
      console.error('Firebase chat error:', error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const sendMessage = async () => {
    if (inputText.trim() && myId) {
      const sharedId = partnerId ? [myId, partnerId].sort().join('_') : myId;
      const chatRef = ref(database, `chats/${sharedId}`);
      const newMessageRef = push(chatRef);
      await set(newMessageRef, {
        text: inputText,
        senderId: myId,
        timestamp: Date.now(),
      });
      setInputText('');
    }
  };

  const renderItem = ({ item }: any) => {
    const isMe = item.senderId === myId;
    const timeString = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return (
      <View className={`mb-4 max-w-[80%] ${isMe ? 'self-end' : 'self-start'}`}>
        <View 
          style={{ 
            backgroundColor: isMe ? themeColors.primary : '#ffffff', 
            borderColor: isMe ? themeColors.primary : '#e5e7eb',
            borderWidth: 1,
            borderRadius: 16,
            borderTopRightRadius: isMe ? 4 : 16,
            borderTopLeftRadius: isMe ? 16 : 4,
            padding: 12,
            paddingHorizontal: 16
          }}
        >
          <Text style={{ fontSize: 16, color: isMe ? '#ffffff' : '#1f2937' }}>{item.text}</Text>
        </View>
        <Text className={`text-xs text-gray-400 mt-1 ${isMe ? 'text-right' : 'text-left'}`}>{timeString}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: themeColors.background }}>
      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={themeColors.primary} />
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, paddingTop: 24 }}
          />
        )}
        <View style={{ padding: 16, backgroundColor: themeColors.card, borderTopWidth: 1, borderTopColor: themeColors.secondary, flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor="#9ca3af"
            style={{ flex: 1, backgroundColor: '#f3f4f6', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, marginRight: 12, color: '#1f2937', minHeight: 48 }}
            multiline
          />
          <TouchableOpacity 
            onPress={sendMessage}
            style={{ backgroundColor: themeColors.primary, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }}
            disabled={!inputText.trim()}
          >
            <Send size={20} color="white" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
