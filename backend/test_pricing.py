import unittest
from unittest.mock import patch

from backend.operations_api import call_cost
from backend.pricing import ASREstimate, DEFAULT_MODEL, pricing_catalog, summarize_token_cost
from backend import test_server as fixture
from backend.server import month


def call(**changes):
    return dict({'kind': 'ark', 'state': 'complete', 'model': DEFAULT_MODEL,
                 'input_tokens': 1000000, 'output_tokens': 1000000,
                 'cached_input_tokens': 0}, **changes)


class PricingTests(unittest.TestCase):
    def test_asr_prices_audio_even_when_recognition_is_interrupted(self):
        estimate = ASREstimate()
        for model, seconds, state in (
                ('volc.seedasr.sauc', 400, 'complete'),
                ('volc.seedasr.sauc', 139.6, 'unknown'),
                ('volc.seedasr.sauc', 0, 'unknown')):
            estimate.add({'model': model, 'seconds': seconds, 'state': state})
        result = estimate.result()
        self.assertEqual(result['amount_cny'], '0.149889')
        self.assertEqual(result['estimated_seconds'], 539.6)
        self.assertEqual(result['no_audio_calls'], 1)
        self.assertEqual(result['unsettled_duration_calls'], 1)
        self.assertEqual(result['legacy_resource_calls'], 2)
        self.assertEqual(result['unpriced_calls'], 0)

    def test_asr_resources_and_missing_duration(self):
        estimate = ASREstimate()
        for model, seconds, state in (
                ('volc.bigasr.sauc.duration', 20, 'complete'),
                ('volc.seedasr.auc', 18, 'complete'),
                ('volc.seedasr.sauc.concurrent', 20, 'complete'),
                ('volc.seedasr.auc', 0, 'complete'),
                ('volc.seedasr.sauc.duration', 0, 'reserved'),
                ('volc.unknown', 10, 'complete')):
            estimate.add({'model': model, 'seconds': seconds, 'state': state})
        result = estimate.result()
        self.assertIsNone(result['amount_cny'])
        self.assertEqual(result['known_amount_cny'], '0.029000')
        self.assertEqual(result['unknown_reasons'], {
            'concurrent_subscription': 1, 'missing_audio_duration': 2, 'unknown_asr_resource': 1})

    def test_existing_configured_stream_rate_applies_after_resource_logging_change(self):
        record = call(kind='speech', feature='alignment_stream', model='volc.seedasr.sauc.duration',
                      seconds=30, created=5, web_search=0, input_tokens=0, output_tokens=0)
        rates = {'volc.seedasr.sauc': [{'effective_from': 0, 'audio_per_minute': '0.60'}],
                 record['model']: [{'effective_from': 10, 'audio_per_minute': '0.80'}]}
        self.assertEqual(str(call_cost(record, rates)), '0.300')
        self.assertEqual(str(call_cost({**record, 'created': 10}, rates)), '0.400')

    def test_exact_official_prices_and_cache_discount(self):
        result = summarize_token_cost([call(cached_input_tokens=500000),
            call(model='doubao-seed-translation-250915')])
        self.assertEqual(result['amount_cny'], '7.980000')
        self.assertEqual(result['cache_detail_missing_calls'], 0)
        self.assertFalse(result['actual_billing_connected'])

    def test_missing_cache_uses_explicit_undiscounted_reference(self):
        result = summarize_token_cost([call(cached_input_tokens=None)])
        self.assertEqual(result['amount_cny'], '3.500000')
        self.assertEqual(result['cache_detail_missing_calls'], 1)
        self.assertEqual(result['basis'], 'current_official_reference')

    def test_unknown_unsettled_empty_usage_are_not_free(self):
        result = summarize_token_cost([call(), call(state='unknown'),
            call(model='ep-custom'), call(input_tokens=0, output_tokens=0),
            call(kind='speech', model='speech')])
        self.assertIsNone(result['amount_cny'])
        self.assertEqual(result['known_amount_cny'], '3.500000')
        self.assertEqual(result['unpriced_calls'], 3)
        self.assertEqual(result['excluded_non_token_calls'], 1)

    def test_exact_model_mapping_and_input_validation(self):
        for values in ({'model': 'doubao-seed-2-1-lite-future'},
                       {'cached_input_tokens': 1000001}, {'input_tokens': True},
                       {'cached_input_tokens': -1}, {'output_tokens': '100'},
                       {'model': 'doubao-seed-translation-250915', 'cached_input_tokens': 1}):
            with self.subTest(values=values):
                self.assertIsNone(summarize_token_cost([call(**values)])['amount_cny'])

    def test_zero_and_decimal_totals_and_catalog(self):
        self.assertEqual(summarize_token_cost([])['amount_cny'], '0.000000')
        result = summarize_token_cost(call(input_tokens=1, output_tokens=1) for _ in range(100000))
        self.assertEqual(result['amount_cny'], '0.350000')
        with patch.dict('os.environ', {'ARK_LEARNING_MODEL': 'ep-private'}):
            self.assertEqual(pricing_catalog()['default_model'], 'ep-private')
        self.assertEqual(pricing_catalog()['checked_at'], '2026-11-06')


class IntegrationTests(unittest.TestCase):
    setUp = fixture.Tests.setUp
    upstream = fixture.Tests.upstream
    call = fixture.Tests.call

    def test_reference_cost_does_not_rewrite_configured_history(self):
        self.call('/v1/ark/responses', self.body)
        result = self.gateway.operations_overview(month())
        self.assertIsNone(result['summary']['estimated_cost_cny'])
        self.assertEqual(result['summary']['token_estimate']['amount_cny'], '0.000019')
        self.assertEqual(result['models'][0]['token_estimate']['amount_cny'], '0.000019')
        self.assertEqual(result['cost_rates'], [])
        self.assertEqual(result['pricing_catalog']['mode'], 'standard_online')

    def test_operations_combines_token_and_asr_without_rewriting_call_states(self):
        self.call('/v1/ark/responses', self.body)
        with self.gateway.db() as db:
            user = db.execute("SELECT user FROM calls WHERE kind='ark'").fetchone()[0]
            for key, kind, model, seconds in (('interrupted', 'speech', 'volc.seedasr.sauc', 539.6),
                                              ('no-usage', 'ark', DEFAULT_MODEL, 0)):
                db.execute("""INSERT INTO calls(id,user,app,month,kind,state,model,seconds,created)
                              VALUES (?,?,?,?,?,'unknown',?,?,1)""",
                           (key,user,self.headers['X-App-Id'],month(),kind,model,seconds))
        result = self.gateway.operations_overview(month())
        official = result['summary']['official_estimate']
        self.assertEqual(official['known_amount_cny'], '0.149908')
        self.assertIsNone(official['amount_cny'])
        self.assertEqual(official['unknown_reasons'], {'unsettled': 1})
        self.assertEqual(result['summary']['uncertain'], 2)
        person = next(row for row in result['users'] if row['user_id'] == user)
        self.assertEqual(person['official_estimate'], official)
        asr = next(row for row in result['models'] if row['model'] == 'volc.seedasr.sauc')
        self.assertEqual(asr['official_estimate']['amount_cny'], '0.149889')
        self.assertEqual(asr['asr_estimate']['unsettled_duration_calls'], 1)


if __name__ == '__main__':
    unittest.main()
