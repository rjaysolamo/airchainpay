import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

import { TxQueue, LogicalNonceGroup } from '../services/TxQueue';
import { logger } from '../utils/Logger';
import { Colors } from '../constants/Colors';
import { useThemeContext } from '../hooks/useThemeContext';

interface PendingSequenceWarningProps {
  /**
   * Optional external refresh signal. Increment/change this to force the
   * component to re-read the queue (e.g. after enqueuing a new offline
   * payment). When omitted, the component loads once on mount.
   */
  refreshKey?: number | string;
}

/**
 * PendingSequenceWarning
 *
 * Renders the queue of escrow-backed offline payments (OfflineSecurityVault
 * Module 2) grouped by logical-nonce sequence, and raises a prominent warning
 * whenever a sequence has a gap (a missing earlier logical nonce). Gaps matter
 * because {@link OfflineSecurityVault.executeOfflinePayment} enforces strict,
 * gap-free ordering: a payment with logical nonce N cannot settle on-chain
 * until every nonce below N for that sender has settled. A missing nonce
 * therefore blocks every later payment in the sequence.
 *
 * This component is read-only: it visualizes state derived from
 * {@link TxQueue.getLogicalNonceGroups} and does not mutate the queue.
 */
export const PendingSequenceWarning: React.FC<PendingSequenceWarningProps> = ({ refreshKey }) => {
  const [groups, setGroups] = useState<LogicalNonceGroup[]>([]);
  const { colorScheme } = useThemeContext();
  const theme = colorScheme || 'light';
  const colors = Colors[theme];

  const loadGroups = useCallback(async () => {
    try {
      const nonceGroups = await TxQueue.getLogicalNonceGroups();
      setGroups(nonceGroups);
    } catch (error) {
      logger.error('[PendingSequenceWarning] Failed to load logical nonce groups:', error);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups, refreshKey]);

  if (groups.length === 0) {
    return null;
  }

  const shortAddr = (addr?: string): string =>
    addr && addr.length > 10 ? `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}` : addr || 'unknown';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {groups.map((group) => {
        const hasGap = !group.isContiguous;
        const accent = hasGap ? '#FF8800' : colors.primary;
        const key = `${group.chainId}:${group.from ?? ''}`;

        return (
          <View
            key={key}
            style={[
              styles.groupContainer,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderLeftColor: accent,
              },
            ]}
          >
            <View style={styles.header}>
              <Text style={styles.icon}>{hasGap ? '⚠️' : '🔗'}</Text>
              <Text style={[styles.title, { color: colors.text }]}>
                Offline Sequence · Chain {group.chainId}
              </Text>
              <Text style={[styles.count, { color: colors.text }]}>
                {group.transactions.length}
              </Text>
            </View>

            <Text style={[styles.subtitle, { color: colors.text }]}>
              Sender {shortAddr(group.from)} · nonces {group.minNonce}–{group.maxNonce}
            </Text>

            {hasGap && (
              <View style={[styles.gapBanner, { borderColor: accent }]}>
                <Text style={[styles.gapText, { color: accent }]}>
                  Pending Sequence: waiting on logical nonce
                  {group.missingNonces.length > 1 ? 's' : ''} {group.missingNonces.join(', ')}.
                  Later payments cannot settle until the missing one
                  {group.missingNonces.length > 1 ? 's' : ''} arrive.
                </Text>
              </View>
            )}

            <ScrollView style={styles.txList} showsVerticalScrollIndicator={false}>
              {group.transactions.map((tx) => (
                <View key={tx.id} style={[styles.txItem, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.txNonce, { color: accent }]}>#{tx.logicalNonce}</Text>
                  <View style={styles.txBody}>
                    <Text style={[styles.txText, { color: colors.text }]} numberOfLines={1}>
                      {tx.amount} {tx.token?.symbol ?? ''} → {shortAddr(tx.to)}
                    </Text>
                    <Text style={[styles.txMeta, { color: colors.text }]}>
                      {tx.status} · {new Date(tx.timestamp).toLocaleString()}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  groupContainer: {
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  icon: {
    fontSize: 18,
    marginRight: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    flex: 1,
  },
  count: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.7,
  },
  subtitle: {
    fontSize: 12,
    opacity: 0.8,
    marginBottom: 8,
  },
  gapBanner: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  gapText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  txList: {
    maxHeight: 160,
  },
  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  txNonce: {
    fontSize: 13,
    fontWeight: 'bold',
    width: 44,
  },
  txBody: {
    flex: 1,
  },
  txText: {
    fontSize: 13,
  },
  txMeta: {
    fontSize: 10,
    opacity: 0.7,
    marginTop: 2,
  },
});

export default PendingSequenceWarning;
