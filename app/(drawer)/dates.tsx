import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Heart, CheckCircle } from 'lucide-react-native';
import { useAuth } from '@/src/context/AuthContext';
import { ref, onValue, set, update, database } from '@/src/services/firebase';

export default function DatesScreen() {
  const { myId, partnerId, themeColors } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [ideas, setIdeas] = useState<any[]>([]);

  useEffect(() => {
    if (!myId) {
      setIsLoading(false);
      return;
    }

    const sharedId = partnerId ? [myId, partnerId].sort().join('_') : myId;
    const datesRef = ref(database, `dates/${sharedId}`);

    const unsubscribe = onValue(datesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const loadedIdeas = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        }));
        setIdeas(loadedIdeas);
        setIsLoading(false);
      } else {
        const initialIdeas = [
          { title: 'Sunset Picnic', description: 'Pack some cheese, wine, and watch the sun go down.', is_favorite: false, is_completed: false },
          { title: 'DIY Pottery Night', description: 'Get some clay and follow a YouTube tutorial.', is_favorite: false, is_completed: false },
          { title: 'Stargazing Drive', description: 'Drive out to the country to look at the stars.', is_favorite: false, is_completed: false },
          { title: 'Cook a New Recipe', description: 'Pick a random fancy recipe and cook it together.', is_favorite: false, is_completed: false },
          { title: 'Indoor Fort + Movies', description: 'Build a blanket fort and have a movie marathon.', is_favorite: false, is_completed: false },
          { title: 'Hike a New Trail', description: 'Find a nature trail we haven’t explored yet.', is_favorite: false, is_completed: false },
          { title: 'Local Museum', description: 'Visit a free local museum or art gallery.', is_favorite: false, is_completed: false },
        ];
        
        const initialData: Record<string, any> = {};
        initialIdeas.forEach((idea, index) => {
          initialData[`idea_${index}`] = idea;
        });
        
        set(datesRef, initialData).then(() => {
          setIsLoading(false);
        });
      }
    });

    return () => unsubscribe();
  }, [myId, partnerId]);

  const handleToggleFavorite = async (ideaId: string) => {
    const idea = ideas.find(i => i.id === ideaId);
    if (!idea || !myId) return;
    const sharedId = partnerId ? [myId, partnerId].sort().join('_') : myId;
    const ideaRef = ref(database, `dates/${sharedId}/${ideaId}`);
    await update(ideaRef, { is_favorite: !idea.is_favorite });
  };

  const handleToggleComplete = async (ideaId: string) => {
    const idea = ideas.find(i => i.id === ideaId);
    if (!idea || !myId) return;
    const sharedId = partnerId ? [myId, partnerId].sort().join('_') : myId;
    const ideaRef = ref(database, `dates/${sharedId}/${ideaId}`);
    await update(ideaRef, { is_completed: !idea.is_completed });
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-rose-50">
        <ActivityIndicator size="large" color="#f43f5e" />
      </View>
    );
  }

  const bgColor = themeColors.background;
  const textColor = themeColors.text;
  const cardBg = themeColors.card;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bgColor }}>
      <View className="px-6 py-8 mt-12">
        <Text style={{ fontSize: 24, fontWeight: 'bold', color: textColor, marginBottom: 8 }}>Date Ideas ✨</Text>
        <Text className="text-slate-500 mb-6">Your couple bucket list</Text>
        
        {ideas.length === 0 ? (
          <Text className="text-slate-500">No date ideas found. Add some!</Text>
        ) : (
          <View className="space-y-4">
            {ideas.map((idea, index) => (
              <View key={idea.id || index} style={{ padding: 16, borderRadius: 24, backgroundColor: cardBg, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1, marginBottom: 16, opacity: idea.is_completed ? 0.7 : 1, borderColor: themeColors.secondary, borderWidth: 1 }}>
                <Text style={{ fontSize: 18, fontWeight: '600', color: textColor, textDecorationLine: idea.is_completed ? 'line-through' : 'none' }}>
                  {idea.title}
                </Text>
                {idea.description ? (
                  <Text className="text-sm text-slate-600 mt-1">{idea.description}</Text>
                ) : null}
                
                <View className="flex-row items-center justify-between mt-4 border-t border-slate-100 pt-3">
                  <TouchableOpacity 
                    onPress={() => handleToggleFavorite(idea.id)}
                    className="flex-row items-center space-x-2"
                  >
                    <Heart 
                      size={20} 
                      color={idea.is_favorite ? themeColors.primary : "#94a3b8"} 
                      fill={idea.is_favorite ? themeColors.primary : "transparent"} 
                    />
                    <Text style={{ fontSize: 14, marginLeft: 4, fontWeight: idea.is_favorite ? '500' : 'normal', color: idea.is_favorite ? themeColors.primary : '#64748b' }}>
                      {idea.is_favorite ? 'Loved' : 'Like'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    onPress={() => handleToggleComplete(idea.id)}
                    className="flex-row items-center space-x-2"
                  >
                    <CheckCircle 
                      size={20} 
                      color={idea.is_completed ? "#10b981" : "#94a3b8"} 
                    />
                    <Text className={`text-sm ml-1 ${idea.is_completed ? 'text-emerald-500 font-medium' : 'text-slate-500'}`}>
                      {idea.is_completed ? 'Done' : 'Mark Done'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
