namespace Pako.Domain.Payroll;

public class Employee
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }

    // Display name, kept as "First Last" whenever FirstName/LastName are set. Employees created
    // before the HR module only have Name.
    public string Name { get; set; } = string.Empty;
    public string? FirstName { get; set; }
    public string? LastName { get; set; }

    // Kosovo personal number (numri personal, 10 digits) — required on the monthly EDI declaration.
    public string? PersonalNumber { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public DateOnly? BirthDate { get; set; }
    public DateOnly? HireDate { get; set; }
    public DateOnly? TerminationDate { get; set; }
    public string? JobTitle { get; set; }
    public Guid? DepartmentId { get; set; }
    public Guid? ManagerId { get; set; }

    // The login this employee uses, if any. Drives ClientStaff access (department permissions,
    // partner assignments). Unique per company.
    public Guid? UserId { get; set; }

    // Salaries must be paid through a bank in Kosovo.
    public string? Iban { get; set; }
    public string? BankName { get; set; }

    // Fallback base salary when no EmployeeContract covers the payroll period.
    public decimal MonthlyGrossSalary { get; set; }

    // The employee designates one primary employer at hire; a secondary employer withholds a
    // flat rate with no 0% band.
    public bool IsPrimaryEmployer { get; set; } = true;

    // Past pension age or otherwise exempt from Trusti contributions — both shares are zero.
    public bool PensionExempt { get; set; }
    public bool IsActive { get; set; } = true;

    public static string DisplayName(string? first, string? last, string? fallback) =>
        string.Join(' ', new[] { first, last }.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim())) is { Length: > 0 } joined
            ? joined
            : fallback?.Trim() ?? string.Empty;

    public bool IsEmployedDuring(DateOnly start, DateOnly end) =>
        (HireDate is null || HireDate <= end) && (TerminationDate is null || TerminationDate >= start);
}
