import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SUPPORTED_CHAINS } from '../src/constants/AppConfig';
import { ThemedView } from '../components/ThemedView';
import { logger } from '../src/utils/Logger';
import { Colors, getBlueBlackGradient, getChainColor } from '../constants/Colors';
import { useThemeContext } from '../hooks/useThemeContext';
import { VaultService, EscrowPosition, NATIVE_TOKEN_ADDRESS } from '../src/services/VaultService';
import { PendingSequenceWarning } from '../src/components/PendingSequenceWarning';


/**
 * VaultManagerScreen
 *
 * Escrow / Vault management surface for the {@link OfflineSecurityVault}. Lets a
 * user sequester native-currency collateral before going offline, view their
 * escrowed vs. available (unreserved) balance, and run the cooldown-gated
 * withdrawal lifecycle (request → wait → withdraw / cancel). Also surfaces the
 * next logical nonce so users understand their offline sequence position.
 *
 * The screen is defensive about configuration: chains without a `vaultAddress`
 * are shown an inline "not configured" state instead of triggering call-site
 * errors, matching how VaultService guards its calls.
 */
export default function VaultManagerScreen() {
  const [selectedChain, setSelectedChain] = useState('base_sepolia');
  const [amount, setAmount] = useState('');
  const [position, setPosition] = useState<EscrowPosition | null>(null);
  const [nextNonce, setNextNonce] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  const { colorScheme } = useThemeContext();
  const theme = colorScheme || 'light';
  const colors = Colors[theme];

  const vaultService = VaultService.getInstance();
  const chain = SUPPORTED_CHAINS[selectedChain];
  const nativeSymbol = chain?.nativeCurrency.symbol ?? '';
  const nativeDecimals = chain?.nativeCurrency.decimals ?? 18;
  const vaultConfigured = vaultService.isVaultConfigured(selectedChain);

  const loadPosition = useCallback(async () => {
    if (!vaultService.isVaultConfigured(selectedChain)) {
      setPosition(null);
      setNextNonce(null);
      return;
    }
    try {
      const [pos, nonce, cooldown] = await Promise.all([
        vaultService.getEscrowPosition(selectedChain, NATIVE_TOKEN_ADDRESS, nativeSymbol, nativeDecimals),
        vaultService.getNextLogicalNonce(selectedChain),
        vaultService.getWithdrawalCooldownSeconds(selectedChain),
      ]);
      setPosition(pos);
      setNextNonce(nonce);
      setCooldownSeconds(cooldown);
    } catch (error) {
      logger.error('[VaultManager] Failed to load escrow position:', error);
      // Leave prior state; surface a non-blocking message.
      Alert.alert('Unable to load vault', 'Could not read your escrow balance. Pull to refresh to retry.');
    }
  }, [selectedChain, nativeSymbol, nativeDecimals, vaultService]);

  useEffect(() => {
    setLoading(true);
    loadPosition().finally(() => setLoading(false));
  }, [loadPosition]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPosition();
    setRefreshing(false);
  }, [loadPosition]);

  const runAction = async (
    label: string,
    fn: () => Promise<string>,
    successMessage: string
  ) => {
    setActionInFlight(label);
    try {
      const hash = await fn();
      logger.info(`[VaultManager] ${label} tx submitted`, { hash });
      Alert.alert('Submitted', `${successMessage}\n\nTx: ${hash.slice(0, 10)}...`);
      await loadPosition();
    } catch (error) {
      logger.error(`[VaultManager] ${label} failed:`, error);
      Alert.alert('Transaction Failed', error instanceof Error ? error.message : String(error));
    } finally {
      setActionInFlight(null);
    }
  };

  const validateAmount = (): boolean => {
    const num = parseFloat(amount.trim());
    if (isNaN(num) || num <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid positive amount.');
      return false;
    }
    return true;
  };

  const handleDeposit = () => {
    if (!validateAmount()) return;
    runAction(
      'deposit',
      () => vaultService.depositToEscrow(selectedChain, NATIVE_TOKEN_ADDRESS, amount.trim(), nativeDecimals),
      `Deposited ${amount.trim()} ${nativeSymbol} into escrow.`
    ).then(() => setAmount(''));
  };

  const handleRequestWithdrawal = () => {
    if (!validateAmount()) return;
    const cooldownHours = Math.round(cooldownSeconds / 3600);
    Alert.alert(
      'Request Withdrawal',
      `Requested funds remain in escrow (and slashable) for a ${cooldownHours}h cooldown before you can withdraw them. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request',
          onPress: () =>
            runAction(
              'request',
              () => vaultService.requestWithdrawal(selectedChain, NATIVE_TOKEN_ADDRESS, amount.trim(), nativeDecimals),
              `Withdrawal of ${amount.trim()} ${nativeSymbol} requested.`
            ).then(() => setAmount('')),
        },
      ]
    );
  };

  const handleCancelWithdrawal = () => {
    runAction(
      'cancel',
      () => vaultService.cancelWithdrawalRequest(selectedChain, NATIVE_TOKEN_ADDRESS),
      'Withdrawal request cancelled; funds stay escrowed.'
    );
  };

  const handleWithdraw = () => {
    runAction(
      'withdraw',
      () => vaultService.withdrawFromEscrow(selectedChain, NATIVE_TOKEN_ADDRESS),
      'Escrow withdrawal completed.'
    );
  };

  const hasPendingWithdrawal = !!position && parseFloat(position.pendingWithdrawal) > 0;
  const unlockDate = position && position.unlockTime > 0 ? new Date(position.unlockTime * 1000) : null;
  const canWithdrawNow = !!unlockDate && unlockDate.getTime() <= Date.now();

  const chainOptions = Object.keys(SUPPORTED_CHAINS);

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: '',
          headerStyle: { backgroundColor: 'transparent' },
          headerTransparent: true,
          headerBackTitle: 'Back',
          headerTintColor: 'white',
        }}
      />
      <LinearGradient colors={getBlueBlackGradient('primary') as any} style={styles.header}>
        <View style={styles.headerContent}>
          <Ionicons name="lock-closed" size={24} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.headerTitle}>Vault & Escrow</Text>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} />}
        >
          {/* Network selector */}
          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: colors.text, fontWeight: 'bold', marginBottom: 8, fontSize: 16 }}>
              Network
            </Text>
            <View style={styles.chipRow}>
              {chainOptions.map((chainId) => (
                <TouchableOpacity
                  key={chainId}
                  style={[
                    styles.networkChip,
                    {
                      backgroundColor: getChainColor(chainId) + '20',
                      borderColor: getChainColor(chainId),
                    },
                    selectedChain === chainId && { borderWidth: 2 },
                  ]}
                  onPress={() => {
                    setSelectedChain(chainId);
                    setAmount('');
                  }}
                >
                  <Text
                    style={[
                      styles.networkChipText,
                      { color: getChainColor(chainId) },
                      selectedChain === chainId && { fontWeight: 'bold' },
                    ]}
                  >
                    {SUPPORTED_CHAINS[chainId].name} {selectedChain === chainId ? '✓' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {!vaultConfigured ? (
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.rowCenter}>
                <Ionicons name="alert-circle-outline" size={22} color="#FF8800" style={{ marginRight: 8 }} />
                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                  Vault Not Configured
                </Text>
              </View>
              <Text style={[styles.infoText, { color: colors.icon, marginTop: 8 }]}>
                The offline security vault has not been deployed/configured for{' '}
                {chain?.name || 'this network'} yet. Escrow and offline sequencing features are
                unavailable here. Select another network or configure a vault address.
              </Text>
            </View>
          ) : loading ? (
            <View style={[styles.card, { backgroundColor: colors.card, alignItems: 'center' }]}>
              <ActivityIndicator color={colors.text} />
              <Text style={[styles.infoText, { color: colors.icon, marginTop: 12 }]}>
                Loading your escrow position…
              </Text>
            </View>
          ) : (
            <>
              {/* Balance summary */}
              <View style={[styles.card, { backgroundColor: colors.card }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Escrow Balance</Text>

                <View style={styles.balanceRow}>
                  <Text style={[styles.balanceLabel, { color: colors.icon }]}>Total escrowed</Text>
                  <Text style={[styles.balanceValue, { color: colors.text }]}>
                    {position?.escrowed ?? '0'} {nativeSymbol}
                  </Text>
                </View>
                <View style={styles.balanceRow}>
                  <Text style={[styles.balanceLabel, { color: colors.icon }]}>Available (backing offline)</Text>
                  <Text style={[styles.balanceValue, { color: '#22aa66' }]}>
                    {position?.available ?? '0'} {nativeSymbol}
                  </Text>
                </View>
                <View style={styles.balanceRow}>
                  <Text style={[styles.balanceLabel, { color: colors.icon }]}>Pending withdrawal</Text>
                  <Text style={[styles.balanceValue, { color: hasPendingWithdrawal ? '#FF8800' : colors.text }]}>
                    {position?.pendingWithdrawal ?? '0'} {nativeSymbol}
                  </Text>
                </View>
                <View style={[styles.balanceRow, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.balanceLabel, { color: colors.icon }]}>Next logical nonce</Text>
                  <Text style={[styles.balanceValue, { color: colors.text }]}>
                    #{nextNonce ?? 0}
                  </Text>
                </View>
              </View>

              {/* Pending withdrawal status */}
              {hasPendingWithdrawal && (
                <View
                  style={[
                    styles.card,
                    { backgroundColor: colors.card, borderLeftWidth: 4, borderLeftColor: '#FF8800' },
                  ]}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Pending Withdrawal</Text>
                  <Text style={[styles.infoText, { color: colors.icon }]}>
                    {position?.pendingWithdrawal} {nativeSymbol} requested.
                    {unlockDate
                      ? canWithdrawNow
                        ? ' Cooldown elapsed — you can withdraw now.'
                        : ` Unlocks ${unlockDate.toLocaleString()}.`
                      : ''}
                  </Text>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.secondaryButton, { borderColor: colors.border }]}
                      onPress={handleCancelWithdrawal}
                      disabled={actionInFlight !== null}
                    >
                      {actionInFlight === 'cancel' ? (
                        <ActivityIndicator color={colors.text} />
                      ) : (
                        <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.primaryButton, { opacity: canWithdrawNow && actionInFlight === null ? 1 : 0.5 }]}
                      onPress={handleWithdraw}
                      disabled={!canWithdrawNow || actionInFlight !== null}
                    >
                      {actionInFlight === 'withdraw' ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.primaryButtonText}>Withdraw</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Amount + deposit / request */}
              <View style={[styles.card, { backgroundColor: colors.card }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Manage Escrow</Text>
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Amount ({nativeSymbol})</Text>
                  <TextInput
                    style={[
                      styles.input,
                      { color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.border },
                    ]}
                    placeholder="0.0"
                    placeholderTextColor={colors.icon}
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                  />
                </View>

                <TouchableOpacity
                  style={[styles.depositButton, { opacity: actionInFlight === null ? 1 : 0.6 }]}
                  onPress={handleDeposit}
                  disabled={actionInFlight !== null}
                >
                  <LinearGradient colors={getBlueBlackGradient('primary') as any} style={styles.depositButtonGradient}>
                    {actionInFlight === 'deposit' ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="arrow-down-circle" size={20} color="#fff" />
                        <Text style={styles.depositButtonText}>Deposit to Escrow</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                {!hasPendingWithdrawal && (
                  <TouchableOpacity
                    style={[styles.secondaryButton, { borderColor: colors.border, marginTop: 12 }]}
                    onPress={handleRequestWithdrawal}
                    disabled={actionInFlight !== null}
                  >
                    {actionInFlight === 'request' ? (
                      <ActivityIndicator color={colors.text} />
                    ) : (
                      <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Request Withdrawal</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          {/* Offline logical-nonce sequence queue + gap warnings. Rendered
              outside the vault-configured branch because the queue is global
              across chains; the component self-hides when empty. */}
          <PendingSequenceWarning refreshKey={refreshing ? 'refreshing' : nextNonce ?? 0} />

          {/* Info card */}
          <View style={[styles.infoCard, { backgroundColor: colors.card }]}>

            <LinearGradient
              colors={[getChainColor(selectedChain) + '20', getChainColor(selectedChain) + '10'] as any}
              style={styles.infoIcon}
            >
              <Ionicons name="shield-checkmark-outline" size={24} color={getChainColor(selectedChain)} />
            </LinearGradient>
            <View style={styles.infoContent}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>How escrow protects offline payments</Text>
              <Text style={[styles.infoText, { color: colors.icon }]}>
                Funds you escrow here back the offline payments you sign while disconnected. A
                cooldown on withdrawals prevents depositing, spending offline, then instantly
                reclaiming the collateral.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 100, paddingBottom: 30, paddingHorizontal: 20 },
  headerContent: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  keyboardAvoidingView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  card: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  networkChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  networkChipText: { fontSize: 14, fontWeight: '500' },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.15)',
  },
  balanceLabel: { fontSize: 14 },
  balanceValue: { fontSize: 15, fontWeight: '600' },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  input: { height: 50, fontSize: 16, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16 },
  depositButton: { borderRadius: 16, overflow: 'hidden' },
  depositButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  depositButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  primaryButton: {
    flex: 1,
    backgroundColor: '#22aa66',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { fontSize: 15, fontWeight: '600' },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, borderRadius: 12 },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoContent: { flex: 1 },
  infoTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  infoText: { fontSize: 14, lineHeight: 20 },
});
