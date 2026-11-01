<?php
namespace SpectrumCredit\Services;


class AssessmentService {
    /**
     * Evaluate customer creditworthiness and policy hard stops
     */
    public static function evaluate(array $customer, int $termMonths, int $monthlyInstallmentCents): array {
        $hardStops = [];
        $score = 50; // base score

        // 1. Age verification (Must be >= 18)
        if (!empty($customer['dob'])) {
            $dob = new \DateTime($customer['dob']);
            $today = new \DateTime();
            $age = $today->diff($dob)->y;
            if ($age < 18) {
                $hardStops[] = "Underage: Applicant is {$age} years old (minimum 18 required)";
            } else if ($age >= 25 && $age <= 55) {
                $score += 15;
            } else {
                $score += 5;
            }
        }

        // 2. CRB Status
        $crbStatus = $customer['crb_status'] ?? 'Clean';
        if ($crbStatus === 'Default') {
            $hardStops[] = "CRB Adverse Listing: Applicant has an active default on credit bureau";
        } else if ($crbStatus === 'Listed') {
            $score -= 20;
        } else {
            $score += 20;
        }

        // 3. Active lease limit (max 1 active lease allowed)
        $activeLeases = (int)($customer['active_leases_count'] ?? 0);
        if ($activeLeases >= 1) {
            $hardStops[] = "Active Lease Limit Exceeded: Applicant currently holds {$activeLeases} active lease(s)";
        }

        // 4. Debt-to-Income / Affordability
        $monthlyIncome = (int)($customer['monthly_income'] ?? 0);
        if ($monthlyIncome > 0 && $monthlyInstallmentCents > 0) {
            $ratio = $monthlyInstallmentCents / $monthlyIncome;
            if ($ratio > 0.40) {
                $hardStops[] = "Affordability Failure: Installment exceeds 40% of declared monthly income";
            } else if ($ratio <= 0.25) {
                $score += 15;
            }
        }

        // Bound score between 0 and 100
        $score = max(0, min(100, $score));

        return [
            'passed' => empty($hardStops) && $score >= 60,
            'score' => $score,
            'hardStops' => $hardStops,
            'recommendation' => empty($hardStops) && $score >= 60 ? 'Approve' : (empty($hardStops) ? 'Refer to Credit Manager' : 'Decline')
        ];
    }
}
