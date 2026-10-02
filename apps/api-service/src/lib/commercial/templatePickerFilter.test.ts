import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCommercialMessageTemplate,
  resolveTemplatePickerPurpose,
  templateMatchesPickerPurpose,
} from './templatePickerFilter';

describe('templatePickerFilter', () => {
  it('classifies category=commercial and legacy Meta names as commercial', () => {
    assert.equal(isCommercialMessageTemplate({ category: 'commercial', meta_template_name: 'x' }), true);
    assert.equal(
      isCommercialMessageTemplate({ category: 'operational', meta_template_name: 'saudacao_generico' }),
      true
    );
    assert.equal(
      isCommercialMessageTemplate({ category: 'operational', meta_template_name: 'flux_prospeccao_formulario' }),
      true
    );
    assert.equal(isCommercialMessageTemplate({ category: 'operational', meta_template_name: 'outro' }), false);
  });

  it('defaults picker purpose to operational when channel/purpose absent', () => {
    assert.equal(resolveTemplatePickerPurpose({}), 'operational');
    assert.equal(resolveTemplatePickerPurpose({ purpose: 'commercial' }), 'commercial');
    assert.equal(resolveTemplatePickerPurpose({ channelPurpose: 'commercial' }), 'commercial');
    assert.equal(
      resolveTemplatePickerPurpose({ purpose: 'operational', channelPurpose: 'commercial' }),
      'operational'
    );
  });

  it('filters templates so commercial and operational lists never mix', () => {
    const commercial = { category: 'commercial', meta_template_name: 'saudacao_generico' };
    const operational = { category: 'operational', meta_template_name: 'aviso_entrega' };
    assert.equal(templateMatchesPickerPurpose(commercial, 'commercial'), true);
    assert.equal(templateMatchesPickerPurpose(commercial, 'operational'), false);
    assert.equal(templateMatchesPickerPurpose(operational, 'operational'), true);
    assert.equal(templateMatchesPickerPurpose(operational, 'commercial'), false);
  });
});
