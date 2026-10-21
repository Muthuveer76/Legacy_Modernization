import java.util.Enumeration;
import java.util.Hashtable;
import java.util.Vector;

/**
 * Account ledger written for Java 1.4: raw collections, manual boxing,
 * synchronized methods and string buffers.
 */
public class LegacyAccountService {
    private static final double OVERDRAFT_FEE = 25.0;
    private Hashtable accounts = new Hashtable();
    private Vector auditLog = new Vector();

    public synchronized void deposit(String id, double amount) {
        if (amount <= 0) {
            auditLog.addElement("Rejected deposit for " + id);
            return;
        }
        Double balance = (Double) accounts.get(id);
        if (balance == null) {
            balance = new Double(0);
        }
        accounts.put(id, new Double(balance.doubleValue() + amount));
        auditLog.addElement("Deposit " + amount + " to " + id);
    }

    public synchronized boolean withdraw(String id, double amount) {
        Double balance = (Double) accounts.get(id);
        if (balance == null) {
            return false;
        }
        double newBalance = balance.doubleValue() - amount;
        if (newBalance < 0) {
            newBalance = newBalance - OVERDRAFT_FEE;
            auditLog.addElement("Overdraft on " + id);
        }
        accounts.put(id, new Double(newBalance));
        return true;
    }

    public double totalBalance() {
        double total = 0;
        Enumeration e = accounts.elements();
        while (e.hasMoreElements()) {
            total += ((Double) e.nextElement()).doubleValue();
        }
        return total;
    }

    public String report() {
        StringBuffer sb = new StringBuffer();
        for (int i = 0; i < auditLog.size(); i++) {
            sb.append(auditLog.elementAt(i)).append("\n");
        }
        return sb.toString();
    }

    public static void main(String[] args) {
        LegacyAccountService service = new LegacyAccountService();
        service.deposit("ACC-1", 500.0);
        service.withdraw("ACC-1", 620.0);
        service.deposit("ACC-2", 75.5);
        System.out.println("Total balance: " + service.totalBalance());
        System.out.print(service.report());
    }
}
