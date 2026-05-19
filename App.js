import "./global.css";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";

export default function App() {
  return (
    <View className="flex-1 bg-white items-center justify-center">
      <Text className="text-3xl font-bold mb-2">Judgement</Text>
      <Text className="text-base text-gray-500">Welcome to the app</Text>
      <StatusBar style="auto" />
    </View>
  );
}
