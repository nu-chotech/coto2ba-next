import { RATIOS, rankToHeat, tierForRank } from '@coto2ba/contracts'
import { StyleSheet, Text, View } from 'react-native'

export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>コトコトバ</Text>
      <Text style={styles.text}>ratios: {RATIOS.join(', ')}</Text>
      <Text style={styles.text}>tier(42) = {tierForRank(42)}</Text>
      <Text style={styles.text}>heat(42) = {rankToHeat(42).toFixed(3)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0B10' },
  text: { color: '#fff', fontSize: 18 },
})
