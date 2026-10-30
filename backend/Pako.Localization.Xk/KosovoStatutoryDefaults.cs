using Pako.Domain.Payroll;

namespace Pako.Localization.Xk;

// The Kosovo payroll values as dated rows, built from the constants that already carry their
// legal source (KosovoPersonalIncomeTaxBrackets, KosovoPensionContribution, KosovoPayrollRules).
// A firm can add an override with a later EffectiveFrom (StatutoryParameter) without a release.
public static class KosovoStatutoryDefaults
{
    // Undated values apply from the start of the current PIT law (Law 08/L-142, Aug 2024); the
    // resolver only needs them to be in force before any payroll period.
    private static readonly DateOnly Baseline = new(2000, 1, 1);

    public static readonly IReadOnlyList<DatedParameterValue> All = Build();

    private static IReadOnlyList<DatedParameterValue> Build()
    {
        var brackets = KosovoPersonalIncomeTaxBrackets.Brackets;
        bool Unverified(SourceConfidence c) => c == SourceConfidence.NeedsLegalVerification;

        var list = new List<DatedParameterValue>
        {
            new(StatutoryParameterKeys.PensionEmployeeRate, Baseline, KosovoPensionContribution.EmployeeRate, NeedsVerification: Unverified(KosovoPensionContribution.Confidence)),
            new(StatutoryParameterKeys.PensionEmployerRate, Baseline, KosovoPensionContribution.EmployerRate, NeedsVerification: Unverified(KosovoPensionContribution.Confidence)),
            new(StatutoryParameterKeys.PitBand1UpperAnnual, Baseline, brackets[0].UpperBoundEurPerYear!.Value, NeedsVerification: Unverified(brackets[0].Confidence)),
            new(StatutoryParameterKeys.PitBand2UpperAnnual, Baseline, brackets[1].UpperBoundEurPerYear!.Value, NeedsVerification: Unverified(brackets[1].Confidence)),
            new(StatutoryParameterKeys.PitRate1, Baseline, brackets[0].Rate, NeedsVerification: Unverified(brackets[0].Confidence)),
            new(StatutoryParameterKeys.PitRate2, Baseline, brackets[1].Rate, NeedsVerification: Unverified(brackets[1].Confidence)),
            new(StatutoryParameterKeys.PitRate3, Baseline, brackets[2].Rate, NeedsVerification: Unverified(brackets[2].Confidence)),
            new(StatutoryParameterKeys.SecondaryEmployerRate, Baseline, KosovoPayrollRules.SecondaryEmployerFlatRate, NeedsVerification: Unverified(KosovoPayrollRules.SecondaryEmployerConfidence)),
            new(StatutoryParameterKeys.OvertimeMultiplier, Baseline, KosovoPayrollRules.OvertimeMultiplier, NeedsVerification: Unverified(KosovoPayrollRules.PremiumsConfidence)),
            new(StatutoryParameterKeys.NightWorkPremium, Baseline, KosovoPayrollRules.NightWorkPremium, NeedsVerification: Unverified(KosovoPayrollRules.PremiumsConfidence)),
            new(StatutoryParameterKeys.WeekendWorkPremium, Baseline, KosovoPayrollRules.WeekendWorkPremium, NeedsVerification: Unverified(KosovoPayrollRules.PremiumsConfidence)),
            new(StatutoryParameterKeys.HolidayWorkPremium, Baseline, KosovoPayrollRules.HolidayWorkPremium, NeedsVerification: Unverified(KosovoPayrollRules.PremiumsConfidence)),
            new(StatutoryParameterKeys.StandardWeeklyHours, Baseline, KosovoPayrollRules.StandardWeeklyHours),
            // Before the first decision on record there was no applicable minimum in this system.
            new(StatutoryParameterKeys.MinimumWage, Baseline, 0m)
        };
        list.AddRange(KosovoPayrollRules.MinimumWages.Select(w =>
            new DatedParameterValue(StatutoryParameterKeys.MinimumWage, w.EffectiveFrom, w.MonthlyGrossEur, NeedsVerification: Unverified(w.Confidence))));
        return list;
    }
}
