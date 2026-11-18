"""Verified public reference prices, separate from historical configured rates.

Never rewrites a bill or sends a network request in the inference path.
"""
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
import os

PRICE_SOURCE = 'https://docs.volcengine.com/docs/ark/model-pricing?lang=zh'
CHECKED_AT = '2026-11-06'
ASR_PRICE_SOURCE = 'https://docs.volcengine.com/docs/doubao-voice/billing-instructions?lang=zh'
ASR_CHECKED_AT = '2026-11-18'
LEGACY_STREAM_MODEL = 'volc.seedasr.sauc'
DEFAULT_STREAM_RESOURCE = 'volc.seedasr.sauc.duration'
ASR_CONCURRENT_RESOURCES = {'volc.seedasr.sauc.concurrent', 'volc.bigasr.sauc.concurrent'}
ASR_PRICES = {
    DEFAULT_STREAM_RESOURCE: {'title': '豆包流式语音识别 2.0（小时版）', 'per_hour': '1.00'},
    'volc.bigasr.sauc.duration': {'title': '大模型流式语音识别 1.0（小时版）', 'per_hour': '4.50'},
    'volc.seedasr.auc': {'title': '豆包录音文件识别 2.0（标准版）', 'per_hour': '0.80'},
}
ASR_NOTE = '按网关记录的音频时长和当前后付费公开价估算。中断调用已记录的音频也计入估算。旧流式记录按网关当时的默认 2.0 小时版估算。并发包月和资源包抵扣以供应商账单为准。'
DEFAULT_MODEL = 'doubao-seed-2-1-lite-260915'
PRICES = {
    DEFAULT_MODEL: {'title': 'Doubao Seed 2.1 Lite', 'input_per_million': '0.80', 'output_per_million': '2.70', 'cached_input_per_million': '0.16'},
    'doubao-seed-translation-250915': {'title': 'Doubao Seed Translation', 'input_per_million': '1.20', 'output_per_million': '3.60', 'cached_input_per_million': None},
}
PRICE_NOTE = '按已核对的火山方舟常规在线公开价参考估算，不是实付账单；历史调用按此价格回算，不改写历史费率。仅含 Token，不含语音、联网、缓存存储、赠额或合同折扣；缓存明细缺失的输入按未命中估算。'


def pricing_catalog():
    model = os.environ.get('ARK_LEARNING_MODEL', DEFAULT_MODEL)
    return {'checked_at': CHECKED_AT, 'source_url': PRICE_SOURCE, 'mode': 'standard_online',
            'default_model': model, 'currency': 'CNY', 'note': PRICE_NOTE,
            'models': [{'model': key, **value} for key, value in PRICES.items()],
            'asr': {'checked_at': ASR_CHECKED_AT, 'source_url': ASR_PRICE_SOURCE, 'note': ASR_NOTE,
                    'models': [{'model': key, **value} for key, value in ASR_PRICES.items()]}}


def money(value):
    return format(value.quantize(Decimal('.000001'), rounding=ROUND_HALF_UP), 'f')


def token_cost(call):
    """Return (cost, missing-cache-detail, reason); only exact known model IDs."""
    call = dict(call)
    if call.get('kind') == 'speech':
        return None, False, 'non_token_call'
    if call.get('state') != 'complete':
        return None, False, 'unsettled'
    rate = PRICES.get(call.get('model'))
    if rate is None:
        return None, False, 'unknown_model'
    incoming, outgoing = call.get('input_tokens'), call.get('output_tokens')
    if any(type(v) is not int or v < 0 for v in (incoming, outgoing)):
        return None, False, 'invalid_usage'
    # A completed record with empty usage in the legacy schema is not a free call.
    if incoming + outgoing == 0:
        return None, False, 'missing_usage'
    cached = call.get('cached_input_tokens')
    missing = cached is None and rate['cached_input_per_million'] is not None
    if cached is not None and (type(cached) is not int or not 0 <= cached <= incoming):
        return None, False, 'invalid_cache_usage'
    cached = cached or 0
    if cached and rate['cached_input_per_million'] is None:
        return None, False, 'unknown_cache_price'
    cost = Decimal(incoming - cached) * Decimal(rate['input_per_million'])
    cost += Decimal(cached) * Decimal(rate['cached_input_per_million'] or '0')
    cost += Decimal(outgoing) * Decimal(rate['output_per_million'])
    return cost / 1000000, missing, None


class TokenEstimate:
    def __init__(self):
        self.amount = Decimal(0)
        self.priced = self.unpriced = self.cache_missing = self.excluded = 0
        self.reasons = defaultdict(int)

    def add(self, call):
        amount, missing, reason = token_cost(call)
        if reason == 'non_token_call':
            self.excluded += 1
        elif amount is None:
            self.unpriced += 1
            self.reasons[reason] += 1
        else:
            self.amount += amount
            self.priced += 1
            self.cache_missing += int(missing)

    def result(self):
        known = money(self.amount)
        return {'amount_cny': known if not self.unpriced else None, 'known_amount_cny': known,
                'priced_calls': self.priced, 'unpriced_calls': self.unpriced,
                'complete': not self.unpriced, 'cache_detail_missing_calls': self.cache_missing,
                'excluded_non_token_calls': self.excluded, 'unknown_reasons': dict(self.reasons),
                'basis': 'current_official_reference', 'currency': 'CNY',
                'checked_at': CHECKED_AT, 'source_url': PRICE_SOURCE, 'note': PRICE_NOTE,
                'actual_billing_connected': False}

    def merge(self, other):
        self.amount += other.amount
        self.priced += other.priced
        self.unpriced += other.unpriced
        self.cache_missing += other.cache_missing
        self.excluded += other.excluded
        for reason, count in other.reasons.items():
            self.reasons[reason] += count


def summarize_token_cost(calls):
    total = TokenEstimate()
    for call in calls:
        total.add(call)
    return total.result()


class ASREstimate:
    def __init__(self):
        self.amount = self.seconds = Decimal(0)
        self.priced = self.unpriced = self.interrupted = self.no_audio = self.legacy = 0
        self.reasons = defaultdict(int)

    def add(self, call):
        model = call['model']
        legacy = model == LEGACY_STREAM_MODEL
        resource = DEFAULT_STREAM_RESOURCE if legacy else model
        rate = ASR_PRICES.get(resource)
        seconds = call['seconds']
        if type(seconds) not in (int, float) or not Decimal(str(seconds)).is_finite() or seconds < 0:
            reason = 'missing_audio_duration'
        elif resource in ASR_CONCURRENT_RESOURCES:
            reason = 'concurrent_subscription'
        elif rate is None:
            reason = 'unknown_asr_resource'
        elif not seconds and (not resource.endswith('.sauc.duration') or call['state'] == 'reserved'):
            reason = 'missing_audio_duration'
        else:
            duration = Decimal(str(seconds))
            self.amount += duration * Decimal(rate['per_hour']) / 3600
            self.seconds += duration
            self.no_audio += int(not seconds)
            self.interrupted += int(seconds > 0 and call['state'] != 'complete')
            self.priced += 1
            self.legacy += int(legacy and seconds > 0)
            return
        self.unpriced += 1
        self.reasons[reason] += 1

    def result(self):
        known = money(self.amount)
        return {'amount_cny': known if not self.unpriced else None, 'known_amount_cny': known,
                'priced_calls': self.priced, 'unpriced_calls': self.unpriced,
                'complete': not self.unpriced, 'unknown_reasons': dict(self.reasons),
                'estimated_seconds': float(self.seconds), 'no_audio_calls': self.no_audio,
                'unsettled_duration_calls': self.interrupted, 'legacy_resource_calls': self.legacy}
