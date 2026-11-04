/// Customer-facing case progress, derived from the same work buckets the web
/// panel uses. One function feeds three places, exactly like a ride-hailing
/// tracker: the vertical timeline in request detail, the mini progress bar on
/// request cards, and the progress bar inside system notifications.
class CaseStage {
  const CaseStage(this.label, this.hint);
  final String label;
  final String hint;
}

const caseStageLabels = <CaseStage>[
  CaseStage('ثبت درخواست', 'درخواست شما با موفقیت ثبت شد.'),
  CaseStage('بررسی کارشناس', 'کارشناس دفتر مدارک و اطلاعات را بررسی می‌کند.'),
  CaseStage('در حال انجام', 'کار شما در حال انجام توسط کارشناس است.'),
  CaseStage('تحویل و تکمیل', 'نتیجه آماده و تحویل شما می‌شود.'),
];

class CaseProgress {
  CaseProgress({
    required this.currentIndex,
    required this.completed,
    required this.failed,
    required this.waitingForCustomer,
    required this.currentLabel,
  });

  /// 0..3 — index into [caseStageLabels] of the stage the case is in now.
  /// When [completed] is true every stage is done.
  final int currentIndex;
  final bool completed;
  final bool failed;
  final bool waitingForCustomer;
  final String currentLabel;

  /// 0..1 for progress bars (cards + system notifications).
  double get fraction {
    if (completed) return 1;
    if (failed) return 0;
    return (currentIndex + 1) / caseStageLabels.length;
  }

  /// How many stages show a green check on the timeline.
  int get doneCount => completed ? caseStageLabels.length : currentIndex;
}

CaseProgress caseProgress({required String status, required String workBucket, String currentStepTitle = ''}) {
  if (status == 'completed' || status == 'delivered') {
    return CaseProgress(currentIndex: 3, completed: true, failed: false, waitingForCustomer: false, currentLabel: 'تکمیل‌شده');
  }
  if (status == 'canceled') {
    return CaseProgress(currentIndex: 0, completed: false, failed: true, waitingForCustomer: false, currentLabel: 'لغوشده');
  }
  if (status == 'rejected') {
    return CaseProgress(currentIndex: 1, completed: false, failed: true, waitingForCustomer: false, currentLabel: 'ردشده');
  }
  final waiting = workBucket == 'waiting_customer';
  if (waiting) {
    return CaseProgress(
      currentIndex: 1,
      completed: false,
      failed: false,
      waitingForCustomer: true,
      currentLabel: currentStepTitle.isEmpty ? 'منتظر اقدام شما' : currentStepTitle,
    );
  }
  switch (workBucket) {
    case 'active':
      return CaseProgress(
        currentIndex: 2,
        completed: false,
        failed: false,
        waitingForCustomer: false,
        currentLabel: currentStepTitle.isEmpty ? 'در حال انجام' : currentStepTitle,
      );
    case 'queue':
    default:
      return CaseProgress(
        currentIndex: 1,
        completed: false,
        failed: false,
        waitingForCustomer: false,
        currentLabel: currentStepTitle.isEmpty ? 'در صف بررسی کارشناس' : currentStepTitle,
      );
  }
}
