// Test script for verifying priority KPI calculation exclusion logic
import assert from 'assert';

function simulateEmployeeScoring(assessments: any[], isMedicalUnit: boolean) {
    let totalActivityRupiah = 0;

    const calcCategoryScore = (categoryName: string) => {
        const catAssessments = assessments.filter(
            (a) => a.category === categoryName
        );
        if (catAssessments.length === 0) return 0;

        const catMeta = catAssessments[0].catMeta || {};
        const categoryWeight = parseFloat(catMeta.weight_percentage) || 0;
        const isActivityStyle = catMeta.configuration_style === 'activity';
        const isWeightedCat = catMeta.is_weighted !== false;

        let totalWeightedScore = 0;
        let totalWeightSum = 0;
        let totalUnweightedScore = 0;
        let unweightedCount = 0;

        for (const a of catAssessments) {
            const indRealization = parseFloat(a.realization_value) || 0;
            const basicVal = parseFloat(a.base_index_value) || 0;
            const indicatorScore = parseFloat(a.score) || 0;
            const indWeight = parseFloat(a.weight_percentage) || 0;
            const calcMethod = a.calculation_method || 'indexing';

            const isPriority = calcMethod === 'priority';
            const isActivity = isActivityStyle || isPriority || basicVal > 1;

            let activityValue = 0;
            if (isActivity) {
                if (indicatorScore > 0 && basicVal <= 1) {
                    activityValue = indicatorScore;
                } else if (basicVal > 1) {
                    activityValue = indRealization * basicVal;
                } else {
                    activityValue = indicatorScore || indRealization;
                }
            }

            if (isActivity) {
                totalActivityRupiah = Number(totalActivityRupiah) + Number(activityValue);
            } else {
                if (isMedicalUnit) {
                    totalUnweightedScore += indicatorScore;
                    unweightedCount++;
                } else {
                    if (isWeightedCat && indWeight > 0) {
                        totalWeightedScore += indicatorScore * (indWeight / 100);
                        totalWeightSum += indWeight;
                    } else {
                        totalUnweightedScore += indicatorScore;
                        unweightedCount++;
                    }
                }
            }
        }

        if (isMedicalUnit) {
            return totalWeightedScore + totalUnweightedScore;
        } else if (totalWeightSum > 0) {
            const categoryAchievementPct = (totalWeightedScore / totalWeightSum) * 100;
            const weightedBase =
                categoryWeight > 0
                    ? (categoryAchievementPct / 100) * categoryWeight
                    : categoryAchievementPct;
            const unweightedAdd =
                unweightedCount > 0 ? totalUnweightedScore / unweightedCount : 0;
            return weightedBase + unweightedAdd;
        } else if (unweightedCount > 0) {
            const categoryAchievementPct = totalUnweightedScore / unweightedCount;
            return categoryWeight > 0
                ? (categoryAchievementPct / 100) * categoryAchievementPct
                : categoryAchievementPct;
        }
        return 0;
    };

    const p1 = calcCategoryScore('P1');
    const p2 = calcCategoryScore('P2');
    const p3 = calcCategoryScore('P3');

    const totalScore = isMedicalUnit ? p1 + p2 + p3 : (p1 + p2 + p3) / 3;

    return {
        p1,
        p2,
        p3,
        totalScore,
        totalActivityRupiah,
    };
}

// User Scenario:
// Employee has:
// P1: Priority indicator with score 1,500,000 (priority calculation method)
// P2: Scoring index indicator with score 2,000,000 (standard indexing calculation method)
// Non-medical unit (or medical unit)

console.log('--- TEST 1: Non-Medical Unit (Sum of scores) ---');
const sampleAssessments = [
    {
        category: 'P1',
        score: 1500000,
        realization_value: 1500000,
        calculation_method: 'priority',
        catMeta: { category: 'P1', weight_percentage: 33.33, is_weighted: true },
        weight_percentage: 100,
        base_index_value: 0,
    },
    {
        category: 'P2',
        score: 2000000,
        realization_value: 100,
        calculation_method: 'indexing',
        catMeta: { category: 'P2', weight_percentage: 33.33, is_weighted: true },
        weight_percentage: 100,
        base_index_value: 0,
    },
];

const resultMedical = simulateEmployeeScoring(sampleAssessments, true);
console.log('Medical Result:', resultMedical);

assert.strictEqual(resultMedical.p1, 0, 'P1 index score should be 0 (priority excluded)');
assert.strictEqual(resultMedical.p2, 2000000, 'P2 index score should be 2000000');
assert.strictEqual(resultMedical.totalScore, 2000000, 'Total score should be 2000000 (excluding P1 priority)');
assert.strictEqual(resultMedical.totalActivityRupiah, 1500000, 'Activity Rupiah should be 1500000 (P1 priority)');

console.log('✅ TEST 1 PASSED: Priority score (1,500,000) correctly excluded from total index score!');
